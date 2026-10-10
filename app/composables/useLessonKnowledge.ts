import { onBeforeUnmount, reactive, watch } from 'vue'
import type { Ref } from 'vue'
import type { Course, VideoEntry } from '~/types/course'
import type { GuideMessage, GuideSettings } from '~/types/guide'
import type { LessonSummary } from '~/types/knowledge'
import type { PracticeScope } from '~/types/practice'
import { retainedCache } from '~/utils/retainedCache'
import { useTranscripts } from '~/composables/useTranscripts'
import { databaseRequest } from '~/utils/database'
import { aiTaskSettings, completeAiBatches, runAiBatches } from '~/utils/aiBatchTask'
import { requestGuideJson } from '~/utils/guideAi'
import { requestValidatedMaterial } from '~/utils/validatedMaterial'
import {
  materialBatches,
  restoreSummary,
  summaryPrompt,
  summarySources,
  transcriptSources,
  validateSummaryPoints,
  synthesisSources,
  wholeSummaryPrompt,
  validateWholeSummary,
} from '~/utils/knowledge'

export function useLessonKnowledge(
  course: Ref<Course | null>,
  settings: GuideSettings,
  configured: Ref<boolean>,
  limits = { entries: 24, weight: 4_000_000 },
) {
  const transcripts = useTranscripts()
  const states = reactive(
    new Map<
      string,
      {
        status: 'idle' | 'loading' | 'transcribing' | 'generating' | 'ready' | 'error'
        summary: LessonSummary | null
        error: string
        progress: string
        storageError: string
        bytes: number
      }
    >(),
  )
  const jobs = new Map<string, { controller: AbortController; promise: Promise<LessonSummary>; background: boolean }>()
  const unsavedTasks = new Map<string, unknown[]>()
  const cache = retainedCache(states, {
    ...limits,
    measure: (value) => value.bytes,
    disposable: (key, value) => !jobs.has(key) && !unsavedTasks.has(key) && !value.storageError,
  })
  function summaryBytes(summary: LessonSummary) {
    return (
      2 *
      (summary.overview.length +
        summary.points.reduce((size, point) => size + point.title.length + point.text.length, 0))
    )
  }
  let aiQueue: Promise<unknown> = Promise.resolve()
  const key = (id: string, path: string, scopes?: PracticeScope[]) => JSON.stringify([id, path, scopes ?? null])
  function get(id: string, path: string, scopes?: PracticeScope[]) {
    const k = key(id, path, scopes)
    if (!states.has(k))
      states.set(k, { status: 'idle', summary: null, error: '', progress: '', storageError: '', bytes: 0 })
    cache.touch(k)
    cache.prune(k)
    return states.get(k)!
  }
  function retain(id: string, path: string, scopes?: PracticeScope[]) {
    return cache.retain(key(id, path, scopes))
  }
  function cancelBackground(id: string, path: string) {
    const job = jobs.get(key(id, path))
    if (job?.background) job.controller.abort()
  }
  function cancel(id: string, path: string) {
    jobs.get(key(id, path))?.controller.abort()
    transcripts.cancel(id, path)
  }
  function cancelAll() {
    for (const [k, job] of jobs) {
      job.controller.abort()
      const state = states.get(k)
      if (state) {
        state.status = 'error'
        state.error = '请求已取消，请重试。'
      }
    }
    jobs.clear()
  }

  async function ensure(
    id: string,
    video: VideoEntry,
    scopes?: PracticeScope[],
    force = false,
    options: { background?: boolean } = {},
  ): Promise<LessonSummary> {
    const k = key(id, video.path, scopes)
    const running = jobs.get(k)
    if (running && !running.controller.signal.aborted) {
      if (!options.background) running.background = false
      return running.promise
    }
    const unsaved = states.get(k)
    if (!force && unsaved?.summary && unsaved.storageError) return unsaved.summary
    const controller = new AbortController()
    const promise = build(id, video, scopes, force, controller).finally(() => {
      if (jobs.get(k)?.controller === controller) jobs.delete(k)
      cache.prune(k)
    })
    jobs.set(k, { controller, promise, background: !!options.background })
    return promise
  }
  async function build(
    id: string,
    video: VideoEntry,
    scopes: PracticeScope[] | undefined,
    force: boolean,
    controller: AbortController,
  ) {
    const state = get(id, video.path, scopes)
    const signal = controller.signal
    const check = () => {
      if (signal.aborted) throw new DOMException('已取消，请重试。', 'AbortError')
    }
    state.error = ''
    state.storageError = ''
    state.status = 'loading'
    state.progress = ''
    try {
      await transcripts.load(id, video)
      check()
      if (transcripts.get(id, video.path).status !== 'ready' && !configured.value) {
        throw new Error('请先在 AI 设置中选择服务，配置后会自动整理知识点。')
      }
      if (transcripts.get(id, video.path).status !== 'ready') state.status = 'transcribing'
      const allCues = await transcripts.prepare(id, video)
      check()
      const cues = scopes ? allCues.filter((c) => scopes.some((s) => c.start >= s.start && c.end <= s.end)) : allCues
      const sources = transcriptSources(cues)
      if (!sources.length) throw new Error('当前学习范围内没有可用逐字稿，无法整理知识点。')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sources)))
      const fingerprint = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('')
      const storageKey = `lesson-knowledge:${key(id, video.path, scopes)}`
      // 读取失败直接停止，不以空数据覆盖已有总结。
      const raw = await databaseRequest<unknown>('settings', { query: { key: storageKey } })
      check()
      const cached = restoreSummary(raw, video.path, fingerprint)
      if (cached && !force) {
        state.summary = cached
        state.bytes = summaryBytes(cached)
        state.status = 'ready'
        return cached
      }
      if (!configured.value) throw new Error('请先在 AI 设置中选择服务，配置后会自动整理知识点。')
      state.status = 'generating'
      const batches = materialBatches(sources)
      const submittedSettings = { ...settings }
      const identity = {
        kind: 'knowledge',
        promptVersion: 2,
        id,
        path: video.path,
        title: video.title,
        scopes,
        fingerprint,
        settings: aiTaskSettings(submittedSettings),
      }
      const taskIdentities: unknown[] = []
      function request(messages: GuideMessage[]) {
        const response = aiQueue
          .catch(() => {})
          .then(() => {
            check()
            return new Promise<unknown>((resolve, reject) => {
              const abort = () => reject(new DOMException('已取消，请重试。', 'AbortError'))
              signal.addEventListener('abort', abort, { once: true })
              requestGuideJson(submittedSettings, messages, signal)
                .then(resolve, reject)
                .finally(() => signal.removeEventListener('abort', abort))
            })
          })
        aiQueue = response
        return response
      }
      const extractionIdentity = { ...identity, stage: 'extract' }
      taskIdentities.push(extractionIdentity)
      const results = await runAiBatches({
        identity: extractionIdentity,
        batches,
        signal,
        reset: force,
        progress: (completed, total) => {
          state.progress = `提炼材料 ${completed} / ${total} 批`
        },
        validate: (raw, batch) => validateSummaryPoints(raw, batch),
        request: (batch) =>
          requestValidatedMaterial({
            messages: summaryPrompt(video.title, batch),
            signal,
            request,
            validate: (raw) => validateSummaryPoints(raw, batch),
          }),
      })
      let points = results.flat()
      if (!points.length) throw new Error('逐字稿中未找到足够的教学内容，无法生成知识点总结。')
      let overview = ''
      // Merge by topic across every batch. Each result is bounded to 6000 characters,
      // so repeated rounds shrink long courses until a single whole-lesson result fits.
      for (let level = 0; ; level++) {
        check()
        const material = synthesisSources(points)
        const mergeBatches = materialBatches(material)
        // Include actual intermediate content: a regenerated extraction must never reuse a stale merge.
        const mergeIdentity = { ...identity, stage: 'synthesize', level, material }
        taskIdentities.push(mergeIdentity)
        const merged = await runAiBatches({
          identity: mergeIdentity,
          batches: mergeBatches,
          signal,
          reset: force,
          progress: (completed, total) => {
            state.progress = `合并整课总结 ${completed} / ${total} 批`
          },
          validate: (raw, batch) => validateWholeSummary(raw, batch),
          request: (batch) =>
            requestValidatedMaterial({
              messages: wholeSummaryPrompt(video.title, batch, mergeBatches.length > 1),
              signal,
              request,
              validate: (raw) => validateWholeSummary(raw, batch),
            }),
        })
        points = merged.flatMap((result) => result.points)
        if (merged.length === 1) {
          overview = merged[0]!.overview
          break
        }
      }
      const summary: LessonSummary = {
        version: 2,
        path: video.path,
        fingerprint,
        createdAt: Date.now(),
        overview,
        points: points.map((p, i) => ({ ...p, id: `k${i + 1}` })),
      }
      check()
      await databaseRequest('settings', { method: 'POST', body: { key: storageKey, value: summary } }).catch(() => {
        if (!signal.aborted) state.storageError = '知识点保存失败，结果已保留，请重试保存。'
      })
      check()
      state.summary = summary
      state.bytes = summaryBytes(summary)
      state.status = 'ready'
      if (state.storageError) unsavedTasks.set(key(id, video.path, scopes), taskIdentities)
      else {
        unsavedTasks.delete(key(id, video.path, scopes))
        for (const task of taskIdentities) await completeAiBatches(task)
      }
      return summary
    } catch (error) {
      if (jobs.get(key(id, video.path, scopes))?.controller === controller) {
        const backgroundCancelled = signal.aborted && jobs.get(key(id, video.path, scopes))?.background
        state.status = backgroundCancelled ? (state.summary ? 'ready' : 'idle') : 'error'
        state.error = backgroundCancelled ? '' : (error as Error).message || '知识点整理失败，请重试。'
        if (state.progress && !signal.aborted) state.error += `（${state.progress}，继续整理会复用已完成批次。）`
      }
      throw error
    }
  }
  async function retrySave(id: string, path: string, scopes?: PracticeScope[]) {
    const state = get(id, path, scopes)
    if (!state.summary || !state.storageError) return
    const summary = state.summary
    try {
      await databaseRequest('settings', {
        method: 'POST',
        body: {
          key: `lesson-knowledge:${key(id, path, scopes)}`,
          value: JSON.parse(JSON.stringify(summary)),
        },
      })
      if (state.summary === summary) {
        state.storageError = ''
        const k = key(id, path, scopes)
        for (const task of unsavedTasks.get(k) ?? []) await completeAiBatches(task)
        unsavedTasks.delete(k)
        cache.prune(k)
      }
    } catch {
      state.storageError = '知识点保存失败，结果已保留，请重试保存。'
    }
  }
  async function sourcesFor(id: string, video: VideoEntry, scopes?: PracticeScope[]) {
    const summary = await ensure(id, video, scopes)
    return summarySources(summary)
  }
  watch(() => course.value?.id, cancelAll, { flush: 'sync' })
  watch(
    () => [
      settings.provider,
      settings.contextWindow,
      settings.baseUrl,
      settings.model,
      settings.apiKey,
      settings.timeoutMinutes,
      configured.value,
    ],
    cancelAll,
    { flush: 'sync' },
  )
  onBeforeUnmount(cancelAll)
  return {
    get,
    ensure,
    sourcesFor,
    cancel,
    cancelBackground,
    retain,
    retrySave,
    cacheInfo: () => ({
      entries: states.size,
      textBytes: [...states.values()].reduce((size, value) => size + value.bytes, 0),
    }),
  }
}

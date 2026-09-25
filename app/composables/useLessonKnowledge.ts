import { onBeforeUnmount, reactive, watch } from 'vue'
import type { Ref } from 'vue'
import type { Course, VideoEntry } from '~/types/course'
import type { GuideSettings } from '~/types/guide'
import type { LessonSummary } from '~/types/knowledge'
import type { PracticeScope } from '~/types/practice'
import { useTranscripts } from '~/composables/useTranscripts'
import { databaseRequest } from '~/utils/database'
import { requestGuideJson } from '~/utils/guideAi'
import { materialBatches, restoreSummary, summaryPrompt, summarySources, transcriptSources, validateSummaryPoints } from '~/utils/knowledge'

export function useLessonKnowledge(course: Ref<Course | null>, settings: GuideSettings, configured: Ref<boolean>) {
  const transcripts = useTranscripts()
  const states = reactive(new Map<string, { status: 'idle' | 'loading' | 'transcribing' | 'generating' | 'ready' | 'error'; summary: LessonSummary | null; error: string; progress: string; storageError: string }>())
  const jobs = new Map<string, { controller: AbortController; promise: Promise<LessonSummary> }>()
  let aiQueue: Promise<unknown> = Promise.resolve()
  const key = (id: string, path: string, scopes?: PracticeScope[]) => JSON.stringify([id, path, scopes ?? null])
  function get(id: string, path: string, scopes?: PracticeScope[]) {
    const k = key(id, path, scopes)
    if (!states.has(k)) states.set(k, { status: 'idle', summary: null, error: '', progress: '', storageError: '' })
    return states.get(k)!
  }
  function cancel(id: string, path: string) {
    jobs.get(key(id, path))?.controller.abort()
    transcripts.cancel(id, path)
  }
  function cancelAll() {
    for (const [k, job] of jobs) {
      job.controller.abort()
      const state = states.get(k)
      if (state) { state.status = 'error'; state.error = '请求已取消，请重试。' }
    }
    jobs.clear()
  }

  async function ensure(id: string, video: VideoEntry, scopes?: PracticeScope[], force = false): Promise<LessonSummary> {
    const k = key(id, video.path, scopes)
    const running = jobs.get(k)
    if (running) return running.promise
    const controller = new AbortController()
    const promise = build(id, video, scopes, force, controller).finally(() => { if (jobs.get(k)?.controller === controller) jobs.delete(k) })
    jobs.set(k, { controller, promise })
    return promise
  }
  async function build(id: string, video: VideoEntry, scopes: PracticeScope[] | undefined, force: boolean, controller: AbortController) {
    const state = get(id, video.path, scopes)
    const signal = controller.signal
    const check = () => { if (signal.aborted) throw new DOMException('已取消，请重试。', 'AbortError') }
    state.error = ''; state.storageError = ''; state.status = 'loading'; state.progress = ''
    try {
      await transcripts.load(id, video)
      check()
      if (transcripts.get(id, video.path).status !== 'ready') state.status = 'transcribing'
      const allCues = await transcripts.prepare(id, video)
      check()
      const cues = scopes ? allCues.filter(c => scopes.some(s => c.start >= s.start && c.end <= s.end)) : allCues
      const sources = transcriptSources(cues)
      if (!sources.length) throw new Error('当前学习范围内没有可用逐字稿，无法整理知识点。')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(sources)))
      const fingerprint = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')
      const storageKey = `lesson-knowledge:${key(id, video.path, scopes)}`
      // 读取失败直接停止，不以空数据覆盖已有总结。
      const raw = await databaseRequest<unknown>('settings', { query: { key: storageKey } })
      check()
      const cached = restoreSummary(raw, video.path, fingerprint)
      if (cached && !force) { state.summary = cached; state.status = 'ready'; return cached }
      if (!configured.value) throw new Error('请先在 AI 设置中选择服务，配置后会自动整理知识点。')
      state.status = 'generating'
      const points: LessonSummary['points'] = []
      const batches = materialBatches(sources)
      const submittedSettings = { ...settings }
      for (const [index, batch] of batches.entries()) {
        check(); state.progress = `${index + 1} / ${batches.length}`
        const response = aiQueue.catch(() => {}).then(() => {
          check()
          // 服务忽略取消或迟到返回时，后续课节仍可继续处理。
          return new Promise<unknown>((resolve, reject) => {
            const abort = () => reject(new DOMException('已取消，请重试。', 'AbortError'))
            signal.addEventListener('abort', abort, { once: true })
            requestGuideJson(submittedSettings, summaryPrompt(video.title, batch), signal)
              .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
          })
        })
        aiQueue = response
        const raw = await response
        check()
        points.push(...validateSummaryPoints(raw, batch))
      }
      if (!points.length) throw new Error('逐字稿中未找到足够的教学内容，无法生成知识点总结。')
      const summary: LessonSummary = { version: 1, path: video.path, fingerprint, createdAt: Date.now(),
        points: points.sort((a, b) => a.start - b.start).map((p, i) => ({ ...p, id: `k${i + 1}` })) }
      check()
      await databaseRequest('settings', { method: 'POST', body: { key: storageKey, value: summary } }).catch(() => {
        if (!signal.aborted) state.storageError = '知识点保存失败，请重新整理以重试保存。'
      })
      check(); state.summary = summary; state.status = 'ready'
      return summary
    } catch (error) {
      if (jobs.get(key(id, video.path, scopes))?.controller === controller) {
        state.status = 'error'; state.error = (error as Error).message || '知识点整理失败，请重试。'
      }
      throw error
    }
  }
  async function sourcesFor(id: string, video: VideoEntry, scopes?: PracticeScope[]) {
    let summary = await ensure(id, video)
    if (scopes) {
      const cues = transcripts.get(id, video.path).segments
      if (cues.some(c => !scopes.some(s => c.start >= s.start && c.end <= s.end))) summary = await ensure(id, video, scopes)
    }
    return summarySources(summary)
  }
  watch(() => course.value?.id, cancelAll, { flush: 'sync' })
  watch(() => [settings.baseUrl, settings.model, settings.apiKey, settings.timeoutMinutes, settings.maxTokens, configured.value], cancelAll, { flush: 'sync' })
  onBeforeUnmount(cancelAll)
  return { get, ensure, sourcesFor, cancel }
}

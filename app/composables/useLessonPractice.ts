import { onBeforeUnmount, computed, reactive, watch } from 'vue'
import type { Ref } from 'vue'
import type { Course, VideoEntry } from '~/types/course'
import type { GuideSettings, SubtitleCue } from '~/types/guide'
import type { PracticeRecord, PracticeScope, PracticeSource } from '~/types/practice'
import { materialBatches } from '~/utils/knowledge'
import { isRecord } from '~/utils/guide'
import { loadLessonSubtitles } from '~/utils/guideMedia'
import { requestGuideJson } from '~/utils/guideAi'
import { enoughPracticeMaterial, practicePrompt, practiceReviewPrompt, practiceSources, validatePracticeQuestion, validatePracticeFeedback, restorePractice, isChoiceQuestion, practiceAnswerText, reviewPracticeChoice, appendPracticeRecord, isRepeatedPracticeQuestion, PRACTICE_ATTEMPT_LIMIT } from '~/utils/practice'
import { dbFetchPractice, dbSavePractice } from '~/utils/dbClient'


interface PracticeOptions {
  mode?: 'lesson' | 'daily'
  fetch?: typeof dbFetchPractice
  save?: typeof dbSavePractice
  sources?: (video: VideoEntry, scope: PracticeScope | null) => Promise<PracticeSource[]>
}
export function useLessonPractice(course: Ref<Course | null>, settings: GuideSettings, available: Ref<boolean>, options: PracticeOptions = {}) {
  const mode = options.mode ?? 'lesson'
  const historyLimit = mode === 'daily' ? 1000 : 20
  const fetchRecords = options.fetch ?? dbFetchPractice
  const saveRecords = options.save ?? dbSavePractice
  const state = reactive({
    open: false, path: '', title: '', scope: null as PracticeScope | null,
    note: '', cues: [] as SubtitleCue[], supplement: '',
    records: [] as PracticeRecord[], selectedId: '', historyReady: false,
    busy: '' as '' | 'loading' | 'generate' | 'review', error: '', storageError: '', materialNotice: '',
    mode, preparedSources: null as PracticeSource[] | null, questionCount: mode === 'daily' ? 5 : 3, generationProgress: '',
  })
  let activeId = ''
  let request: AbortController | null = null
  let historyLoad: Promise<void> = Promise.resolve()
  let courseRevision = 0
  let saveRevision = 0
  const current = computed(() => state.records.find(r => r.id === state.selectedId && r.path === state.path))
  const history = computed(() => state.records.filter(r => r.path === state.path))
  const sources = computed(() => {
    if (state.preparedSources === null) return practiceSources(state.note, state.cues, state.supplement, state.scope)
    if (!state.preparedSources.length || mode === 'daily') return state.preparedSources
    return [...state.preparedSources, ...practiceSources(state.note, [], state.supplement, state.scope).map(s => ({ ...s, id: `m${s.id}` }))]
  })
  const hasMaterial = computed(() => enoughPracticeMaterial(sources.value))
  const configured = computed(() => available.value && !!settings.baseUrl.trim() && !!settings.model.trim())
  const answer = computed(() => current.value ? practiceAnswerText(current.value.question, current.value.draft) : '')
  const answerSubmitted = computed(() => !!answer.value && current.value?.attempts.at(-1)?.answer === answer.value)
  const canReview = computed(() => state.historyReady && !!current.value && !!answer.value && !answerSubmitted.value && !state.busy
    && current.value.attempts.length < PRACTICE_ATTEMPT_LIMIT && (isChoiceQuestion(current.value.question) || configured.value))

  function persist() {
    if (!activeId || !state.path || !state.historyReady) return
    const id = activeId, path = state.path, revision = ++saveRevision, courseVersion = courseRevision
    const recordsForPath: PracticeRecord[] = JSON.parse(JSON.stringify(state.records.filter(r => r.path === path)))
    void saveRecords(id, path, recordsForPath).then(saved => {
      if (courseVersion !== courseRevision || state.path !== path || revision !== saveRevision) return
      state.storageError = saved ? '' : '练习记录保存失败，请关闭后重新打开练习重试。'
    })
  }
  function cancel() { request?.abort(); request = null; state.busy = '' }
  function close() { cancel(); persist(); state.open = false }
  function select(id: string) { if (state.busy) return; state.selectedId = id; state.error = '' }
  function updateDraft(answer: string) { if (current.value && !state.busy) { current.value.draft = answer.slice(0, 8000); state.error = ''; persist() } }

  async function open(video: VideoEntry, scope: PracticeScope | null, noteSnapshot?: string) {
    if (!activeId) return
    cancel()
    persist()
    if (state.path !== video.path || JSON.stringify(state.scope) !== JSON.stringify(scope)) state.supplement = ''
    state.path = video.path; state.title = video.title; state.scope = scope; state.open = true
    state.error = ''; state.materialNotice = ''; state.note = ''; state.cues = []; state.preparedSources = options.sources ? [] : null
    state.selectedId = history.value.find(r => JSON.stringify(r.scope) === JSON.stringify(scope))?.id ?? ''
    const controller = new AbortController(); request = controller; state.busy = 'loading'
    try {
      await historyLoad
      if (controller.signal.aborted) return
      if (!state.historyReady) await (historyLoad = loadHistory())
      if (controller.signal.aborted || !state.historyReady) return
      state.selectedId = history.value.find(r => JSON.stringify(r.scope) === JSON.stringify(scope))?.id ?? ''
      const [cues, note] = await Promise.all([
        loadLessonSubtitles(video),
        noteSnapshot !== undefined ? Promise.resolve(noteSnapshot) : (async () => {
          try {
            const handle = await video.parent.getFileHandle(`${video.title}.md`)
            const file = await handle.getFile()
            if (controller.signal.aborted) return ''
            if (file.size > 1_000_000) { state.materialNotice = '笔记超过 1 MB，请在下方粘贴本次需要的内容。'; return '' }
            return await file.text()
          } catch (err) {
            if (!controller.signal.aborted && (err as Error).name !== 'NotFoundError') state.materialNotice = '笔记读取失败，可在下方补充本次学习内容。'
            return ''
          }
        })(),
      ])
      if (controller.signal.aborted) return
      state.cues = cues; state.note = note
      if (options.sources) {
        const summary = await options.sources(video, scope)
        if (controller.signal.aborted) return
        state.preparedSources = summary
      }
    } catch (err) { if (!controller.signal.aborted) state.error = (err as Error).message }
    finally { if (request === controller) { request = null; state.busy = '' } }
  }

  async function openSources(path: string, title: string, loader: (signal: AbortSignal) => Promise<PracticeSource[]>) {
    if (!activeId) return
    cancel(); persist()
    Object.assign(state, { path, title, scope: null, open: true, error: '', materialNotice: '', note: '', cues: [], supplement: '', preparedSources: [], selectedId: '' })
    const controller = new AbortController(); request = controller; state.busy = 'loading'
    try {
      await historyLoad
      if (controller.signal.aborted) return
      if (!state.historyReady) await (historyLoad = loadHistory())
      if (controller.signal.aborted || !state.historyReady) return
      state.selectedId = history.value.at(-1)?.id ?? ''
      const sources = await loader(controller.signal)
      if (!controller.signal.aborted) state.preparedSources = sources
    } catch (err) { if (!controller.signal.aborted) state.error = (err as Error).message }
    finally { if (request === controller) { request = null; state.busy = '' } }
  }

  async function generate(count = 1) {
    if (state.busy || !state.open || !activeId || !state.historyReady) return
    state.error = ''
    if (!hasMaterial.value) { state.error = '学习材料不足，请补充本课概念、示例或代码后生成练习。'; return }
    if (!configured.value) { state.error = '请先在 AI 设置中填写服务地址和模型。'; return }
    if (!Number.isInteger(count) || count < 1 || count > 8) return
    const controller = new AbortController(); request = controller; state.busy = 'generate'
    // 固定本次提交的材料，等待期间的 UI 变化不能改变题目依据。
    const submitted = sources.value.map(s => ({ ...s }))
    const scope = state.scope ? { ...state.scope } : null
    const path = state.path
    try {
      const allBatches = materialBatches(submitted)
      // 单题续练轮换材料批次，保证按钮始终只新增一题；整组练习覆盖全部批次。
      const batches = count === 1 ? [allBatches[history.value.length % allBatches.length]!] : allBatches
      if (batches.length * count > historyLimit) throw new Error(`知识点较多，请减少每组题数（本次最多保留 ${historyLimit} 题）。`)
      const pending: PracticeRecord[] = []
      const submittedSettings = { ...settings }
      for (const [index, batch] of batches.entries()) {
        state.generationProgress = `${index + 1} / ${batches.length}`
        const raw = await requestGuideJson(submittedSettings, practicePrompt(state.title, batch, scope, [...history.value, ...pending].map(r => r.question), count, mode === 'daily'), controller.signal)
        if (controller.signal.aborted) return
        const questions = count === 1 ? [raw] : isRecord(raw) && Array.isArray(raw.questions) ? raw.questions : []
        if (questions.length !== count) throw new Error('AI 返回的题目数量不完整，请重试。')
        for (const rawQuestion of questions) {
          const question = validatePracticeQuestion(rawQuestion, batch, true)
          if (isRepeatedPracticeQuestion(question, [...history.value, ...pending].map(r => r.question))) {
            throw new Error('AI 返回了已有题目，请点击“再练一题”重试，或补充学习材料。')
          }
          pending.push({ id: crypto.randomUUID(), path, createdAt: Date.now(), scope, sources: batch, question, draft: '', attempts: [] })
        }
      }
      for (const record of pending) state.records = appendPracticeRecord(state.records, record, historyLimit)
      state.selectedId = pending[0]?.id ?? ''; persist()
    } catch (err) { if (!controller.signal.aborted) state.error = (err as Error).message }
    finally { if (request === controller) { request = null; state.busy = '' } }
  }

  async function review() {
    const record = current.value
    if (!state.open || !state.historyReady || !record || state.busy || record.attempts.length >= PRACTICE_ATTEMPT_LIMIT || answerSubmitted.value) return
    state.error = ''
    const answer = practiceAnswerText(record.question, record.draft)
    if (!answer) { state.error = isChoiceQuestion(record.question) ? '请选择答案后提交。' : '请填写作答内容后提交。'; return }
    if (isChoiceQuestion(record.question)) {
      record.attempts.push({ answer, feedback: reviewPracticeChoice(record.question, record.draft), at: Date.now() }); persist(); return
    }
    if (!configured.value) { state.error = '请先选择有效的 AI 配置。'; return }
    const controller = new AbortController(); request = controller; state.busy = 'review'
    try {
      const raw = await requestGuideJson({ ...settings }, practiceReviewPrompt(record, answer), controller.signal)
      if (controller.signal.aborted) return
      record.attempts.push({ answer, feedback: validatePracticeFeedback(raw, record.sources), at: Date.now() }); persist()
    } catch (err) { if (!controller.signal.aborted) state.error = (err as Error).message }
    finally { if (request === controller) { request = null; state.busy = '' } }
  }

  async function loadHistory() {
    const version = courseRevision, id = activeId
    if (!activeId) return
    try {
      const practiceMap = await fetchRecords(id)
      if (version !== courseRevision) return
      const allRecords = Object.values(practiceMap).flat()
      const videoPaths = course.value?.videos.map(v => v.path) ?? []
      const paths = mode === 'daily' ? Object.keys(practiceMap).filter(p => /^daily:\d{4}-\d{2}-\d{2}:/u.test(p)) : videoPaths
      state.records = restorePractice(allRecords.filter(r => r && typeof r.createdAt === 'number').sort((a, b) => b.createdAt - a.createdAt), paths, historyLimit, videoPaths)
      state.historyReady = true; state.storageError = ''
    } catch {
      if (version === courseRevision) state.storageError = '练习记录读取失败，请关闭后重新打开练习重试。'
    }
  }
  watch(() => course.value?.id, () => {
    persist(); cancel(); courseRevision++
    state.open = false; state.records = []; state.selectedId = ''; state.path = ''; state.note = ''; state.cues = []; state.supplement = ''; state.storageError = ''; state.error = ''; state.historyReady = false; state.preparedSources = null
    activeId = course.value?.id ?? ''
    historyLoad = loadHistory()
  }, { immediate: true, flush: 'sync' })
  watch(() => [settings.baseUrl, settings.model, settings.apiKey, settings.timeoutMinutes, settings.maxTokens, available.value], () => {
    if (state.busy !== 'generate' && state.busy !== 'review') return
    cancel(); state.error = 'AI 配置已变更，请重新提交请求。'
  }, { flush: 'sync' })
  onBeforeUnmount(() => { cancel(); persist(); courseRevision++ })
  return { persist, state, current, history, sources, hasMaterial, configured, answerSubmitted, canReview, open, openSources, close, cancel, select, updateDraft, generate, review }
}

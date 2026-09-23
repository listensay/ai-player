import type { Course, VideoEntry } from '~/types/course'
import type { GuideSettings, SubtitleCue } from '~/types/guide'
import type { PracticeRecord, PracticeScope } from '~/types/practice'
import { loadLessonSubtitles } from '~/utils/guideMedia'
import { requestGuideJson } from '~/utils/guideAi'
import { enoughPracticeMaterial, loadPracticeNote, practicePrompt, practiceSources, restorePractice, reviewPrompt, validatePracticeQuestion, validatePracticeFeedback } from '~/utils/practice'
import { dbFetchPractice, dbSavePractice } from '~/utils/dbClient'

const OLD_STORAGE_PREFIX = 'ai-player.practice.v1.'

export function useLessonPractice(course: Ref<Course | null>, settings: GuideSettings) {
  const state = reactive({
    open: false, path: '', title: '', scope: null as PracticeScope | null,
    note: '', cues: [] as SubtitleCue[], supplement: '',
    records: [] as PracticeRecord[], selectedId: '',
    busy: '' as '' | 'loading' | 'generate' | 'review', error: '', storageError: '', materialNotice: '',
  })
  let activeId = ''
  let request: AbortController | null = null
  const current = computed(() => state.records.find(r => r.id === state.selectedId && r.path === state.path))
  const history = computed(() => state.records.filter(r => r.path === state.path))
  const sources = computed(() => practiceSources(state.note, state.cues, state.supplement, state.scope))
  const hasMaterial = computed(() => enoughPracticeMaterial(sources.value))
  const configured = computed(() => !!settings.baseUrl.trim() && !!settings.model.trim())

  function persist() {
    if (!activeId || !state.path) return
    const recordsForPath = state.records.filter(r => r.path === state.path)
    void dbSavePractice(activeId, state.path, recordsForPath as any)
  }
  function cancel() { request?.abort(); request = null; state.busy = '' }
  function close() { cancel(); persist(); state.open = false }
  function select(id: string) { if (state.busy) return; state.selectedId = id; state.error = '' }
  function updateDraft(answer: string) { if (current.value && !state.busy) { current.value.draft = answer.slice(0, 8000); persist() } }

  async function open(video: VideoEntry, scope: PracticeScope | null, noteSnapshot?: string) {
    if (!activeId) return
    cancel()
    if (state.path !== video.path || JSON.stringify(state.scope) !== JSON.stringify(scope)) state.supplement = ''
    state.path = video.path; state.title = video.title; state.scope = scope; state.open = true
    state.error = ''; state.materialNotice = ''; state.note = ''; state.cues = []
    state.selectedId = history.value.find(r => JSON.stringify(r.scope) === JSON.stringify(scope))?.id ?? ''
    const controller = new AbortController(); request = controller; state.busy = 'loading'
    try {
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
    } finally { if (request === controller) { request = null; state.busy = '' } }
  }

  async function generate() {
    if (state.busy || !state.open || !activeId) return
    state.error = ''
    if (!hasMaterial.value) { state.error = '学习材料不足，请补充本次学到的概念、示例或代码，再生成练习。'; return }
    if (!configured.value) { state.error = '请先在 AI 设置中填写服务地址和模型。'; return }
    const controller = new AbortController(); request = controller; state.busy = 'generate'
    // 固定本次提交的材料，等待期间的 UI 变化不能改变题目依据。
    const submitted = sources.value.map(s => ({ ...s }))
    const scope = state.scope ? { ...state.scope } : null
    const path = state.path
    try {
      const raw = await requestGuideJson({ ...settings }, practicePrompt(state.title, submitted, scope), controller.signal)
      if (controller.signal.aborted) return
      const question = validatePracticeQuestion(raw, submitted)
      const record: PracticeRecord = { id: crypto.randomUUID(), path, createdAt: Date.now(), scope, sources: submitted, question, draft: '', attempts: [] }
      state.records = [record, ...state.records].slice(0, 20); state.selectedId = record.id; persist()
    } catch (err) { if (!controller.signal.aborted) state.error = (err as Error).message }
    finally { if (request === controller) { request = null; state.busy = '' } }
  }

  async function review() {
    const record = current.value
    if (!record || state.busy || record.attempts.length >= 3) return
    state.error = ''
    const answer = record.draft.trim()
    if (!answer) { state.error = '先写下你的理解或代码，再查看反馈。'; return }
    const controller = new AbortController(); request = controller; state.busy = 'review'
    try {
      const raw = await requestGuideJson({ ...settings }, practiceReviewPrompt(record, answer), controller.signal)
      if (controller.signal.aborted) return
      record.attempts.push({ answer, feedback: validatePracticeFeedback(raw, record.sources), at: Date.now() }); persist()
    } catch (err) { if (!controller.signal.aborted) state.error = (err as Error).message }
    finally { if (request === controller) { request = null; state.busy = '' } }
  }

  watch(() => course.value?.id, async () => {
    persist(); cancel(); activeId = ''
    state.open = false; state.records = []; state.selectedId = ''; state.path = ''; state.note = ''; state.cues = []; state.supplement = ''; state.storageError = ''; state.error = ''
    activeId = course.value?.id ?? ''
    if (!activeId) return
    try {
      const practiceMap = await dbFetchPractice(activeId)
      const allRecords = Object.values(practiceMap).flat()
      // 迁移旧 localStorage
      if (import.meta.client) {
        try {
          const old = localStorage.getItem(OLD_STORAGE_PREFIX + activeId)
          if (old) {
            const restored = restorePractice(JSON.parse(old), course.value!.videos.map(v => v.path))
            for (const r of restored) {
              if (!allRecords.some(item => item.id === r.id)) {
                allRecords.push(r as any)
                void dbSavePractice(activeId, r.path, [r as any])
              }
            }
            localStorage.removeItem(OLD_STORAGE_PREFIX + activeId)
          }
        } catch { /* 忽略 */ }
      }
      state.records = allRecords as any
    } catch { state.storageError = '练习记录暂时无法读取，可以重新出题。' }
  }, { immediate: true, flush: 'sync' })
  onBeforeUnmount(() => { cancel(); persist() })
  return { state, current, history, sources, hasMaterial, configured, open, close, cancel, select, updateDraft, generate, review }
}

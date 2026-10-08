import { onBeforeUnmount, computed, reactive, watch } from 'vue'
import type { Ref } from 'vue'
import type { Course, VideoEntry } from '~/types/course'
import type { GuideSettings, SubtitleCue } from '~/types/guide'
import type {
  PracticeAttachment,
  PracticeRecord,
  PracticeScope,
  PracticeSource,
  ProgrammingRun,
} from '~/types/practice'
import { aiTaskSettings, completeAiBatches, runAiBatches } from '~/utils/aiBatchTask'
import { materialBatches } from '~/utils/knowledge'
import { prepareDailyPracticeSources } from '~/utils/dailyPractice'
import { isRecord } from '~/utils/guide'
import { loadLessonSubtitles } from '~/utils/guideMedia'
import { requestGuideJson } from '~/utils/guideAi'
import {
  enoughPracticeMaterial,
  practicePrompt,
  practiceReviewPrompt,
  practiceSources,
  validatePracticeQuestion,
  validateDailyPracticeQuestion,
  validatePracticeFeedback,
  restorePractice,
  isChoiceQuestion,
  practiceAnswerText,
  reviewPracticeChoice,
  appendPracticeRecord,
  isRepeatedPracticeQuestion,
  PRACTICE_ATTEMPT_LIMIT,
  PROGRAMMING_HISTORY_LIMIT,
} from '~/utils/practice'
import { dbFetchPractice, dbSavePractice } from '~/utils/dbClient'
import { createPracticeAttachmentStore, readPracticeFile, validateAttachments } from '~/utils/practiceAttachments'
import { assignmentReviewPrompt, programmingReviewPrompt } from '~/utils/practiceGrading'
import { CODE_LIMIT, programmingQuestion } from '~/utils/programming'
import type { ProgrammingPreference } from '~/utils/programming'
import { runProgramming, verifyProgrammingExercise } from '~/utils/programmingRunner'
import { availableProgrammingLanguages } from '~/utils/programmingEnvironments'
import {
  nextPracticeHintLevel,
  practiceHelpLevel,
  practiceHintPrompt,
  validatePracticeHint,
} from '~/utils/practiceHints'

interface PracticeOptions {
  mode?: 'lesson' | 'daily'
  fetch?: typeof dbFetchPractice
  save?: typeof dbSavePractice
  sources?: (video: VideoEntry, scope: PracticeScope | null) => Promise<PracticeSource[]>
  runCode?: typeof runProgramming
}
export function useLessonPractice(
  course: Ref<Course | null>,
  settings: GuideSettings,
  available: Ref<boolean>,
  options: PracticeOptions = {},
) {
  const mode = options.mode ?? 'lesson'
  const historyLimit = mode === 'daily' ? 1000 : 20
  const fetchRecords = options.fetch ?? dbFetchPractice
  const saveRecords = options.save ?? dbSavePractice
  const codeRunner = options.runCode ?? runProgramming
  const initialState = {
    open: false,
    path: '',
    title: '',
    scope: null as PracticeScope | null,
    note: '',
    cues: [] as SubtitleCue[],
    supplement: '',
    records: [] as PracticeRecord[],
    selectedId: '',
    historyReady: false,
    busy: '' as '' | 'loading' | 'generate' | 'review' | 'upload' | 'test' | 'hint',
    error: '',
    hintError: '',
    storageError: '',
    materialNotice: '',
    mode,
    preparedSources: null as PracticeSource[] | null,
    questionCount: mode === 'daily' ? 1 : 3,
    generationProgress: '',
    retryGenerationCount: 0 as number | 'auto',
    programmingPreference: 'auto' as ProgrammingPreference,
  }
  // Keep recursive JSON test inputs out of Vue's recursive UnwrapRef type expansion.
  const state: typeof initialState = reactive(initialState) as typeof initialState
  let activeId = ''
  let request: AbortController | null = null
  let historyLoad: Promise<void> = Promise.resolve()
  let courseRevision = 0
  let saveRevision = 0
  let saveQueue: Promise<boolean | void> = Promise.resolve()
  const attachmentStore = createPracticeAttachmentStore()
  const current = computed(() => state.records.find((r) => r.id === state.selectedId && r.path === state.path))
  const history = computed(() => state.records.filter((r) => r.path === state.path))
  const sources = computed(() => {
    if (state.preparedSources === null) return practiceSources(state.note, state.cues, state.supplement, state.scope)
    if (!state.preparedSources.length || mode === 'daily') return state.preparedSources
    return [
      ...state.preparedSources,
      ...practiceSources(state.note, [], state.supplement, state.scope).map((s) => ({ ...s, id: `m${s.id}` })),
    ]
  })
  const hasMaterial = computed(() => enoughPracticeMaterial(sources.value))
  const configured = computed(() => available.value && !!settings.baseUrl.trim() && !!settings.model.trim())
  const answer = computed(() => (current.value ? practiceAnswerText(current.value.question, current.value.draft) : ''))
  const attachments = computed(() => current.value?.attachments ?? [])
  const hasSubmission = computed(() => !!answer.value.trim() || attachments.value.length > 0)
  const answerSubmitted = computed(() => {
    const previous = current.value?.attempts.at(-1)
    return (
      hasSubmission.value &&
      !!previous &&
      previous.answer === answer.value &&
      (mode !== 'daily' || !!previous.feedback.grade) &&
      JSON.stringify((previous.attachments ?? []).map((file) => file.id).sort()) ===
        JSON.stringify(attachments.value.map((file) => file.id).sort())
    )
  })
  const canReview = computed(
    () =>
      state.historyReady &&
      !!current.value &&
      hasSubmission.value &&
      !answerSubmitted.value &&
      !state.busy &&
      (programmingQuestion(current.value.question) || current.value.attempts.length < PRACTICE_ATTEMPT_LIMIT) &&
      (isChoiceQuestion(current.value.question) || configured.value),
  )

  function persist() {
    if (!activeId || !state.path || !state.historyReady) return
    const id = activeId,
      path = state.path,
      revision = ++saveRevision,
      courseVersion = courseRevision
    const recordsForPath: PracticeRecord[] = JSON.parse(JSON.stringify(state.records.filter((r) => r.path === path)))
    saveQueue = saveQueue
      .catch(() => {})
      .then(() => saveRecords(id, path, recordsForPath))
      .then((saved) => {
        if (courseVersion === courseRevision && state.path === path && revision === saveRevision)
          state.storageError = saved ? '' : '练习记录保存失败，请重试保存。'
        return saved
      })
      .catch(() => {
        if (courseVersion === courseRevision && state.path === path && revision === saveRevision)
          state.storageError = '练习记录保存失败，请重试保存。'
        return false
      })
    return saveQueue
  }
  async function flush() {
    await persist()
    await saveQueue
    if (state.storageError) throw new Error(state.storageError)
  }
  function cancel() {
    request?.abort()
    request = null
    state.busy = ''
  }
  function close() {
    cancel()
    persist()
    state.open = false
    attachmentStore.clear()
  }
  function select(id: string) {
    if (state.busy) return
    state.selectedId = id
    state.error = ''
    state.hintError = ''
  }
  function updateDraft(answer: string) {
    if (current.value && !state.busy) {
      const limit = programmingQuestion(current.value.question) ? CODE_LIMIT : 8000
      if (answer.length > limit) {
        state.error = `作答内容最多 ${limit} 字。`
        return
      }
      current.value.draft = answer
      state.error = ''
      persist()
    }
  }

  function resetCode() {
    const exercise = programmingQuestion(current.value?.question)
    if (exercise && !state.busy) updateDraft(exercise.starterCode)
  }
  async function revealHint() {
    const record = current.value
    if (!record || state.busy || !state.open || !state.historyReady) return
    const level = nextPracticeHintLevel(record)
    if (!level) return
    state.hintError = ''
    if (!configured.value) {
      state.hintError = '请先选择有效的 AI 配置。'
      return
    }
    const controller = new AbortController(),
      revision = courseRevision,
      path = state.path
    request = controller
    state.busy = 'hint'
    try {
      const raw = await requestGuideJson({ ...settings }, practiceHintPrompt(record, level), controller.signal)
      controller.signal.throwIfAborted()
      if (
        courseRevision !== revision ||
        state.path !== path ||
        current.value?.id !== record.id ||
        !state.open ||
        request !== controller
      )
        return
      const hint = validatePracticeHint(raw, level, record.sources)
      record.help = {
        level: Math.max(practiceHelpLevel(record), level) as typeof level | 4,
        hints: [...(record.help?.hints ?? []), { ...hint, viewedAt: Date.now() }],
      }
      await persist()
    } catch (error) {
      if (!controller.signal.aborted && request === controller) state.hintError = (error as Error).message
    } finally {
      if (request === controller) {
        request = null
        state.busy = ''
      }
    }
  }
  function revealReference() {
    const record = current.value
    if (!record || state.busy || !state.open || !state.historyReady) return
    if (record.help?.level === 4) return
    record.help = { level: 4, hints: record.help?.hints ?? [] }
    state.hintError = ''
    persist()
  }
  // 测试用例由出题时固定提供，运行即自动执行全部用例，不提供自选输入。
  async function executeCode() {
    const record = current.value,
      exercise = programmingQuestion(record?.question)
    if (!record || !exercise || state.busy || !state.open || !state.historyReady) return
    const controller = new AbortController()
    request = controller
    state.busy = 'test'
    state.error = ''
    try {
      const result = await codeRunner({ exercise, code: record.draft, mode: 'test' }, controller.signal)
      controller.signal.throwIfAborted()
      record.codeRun = result
      await persist()
    } catch (error) {
      if (!controller.signal.aborted) state.error = (error as Error).message
    } finally {
      if (request === controller) {
        request = null
        state.busy = ''
      }
    }
  }

  async function addAttachments(files: File[]) {
    const record = current.value
    if (
      !record ||
      state.busy ||
      !state.open ||
      !state.historyReady ||
      isChoiceQuestion(record.question) ||
      !files.length
    )
      return
    if ((record.attachments?.length ?? 0) + files.length > 8) {
      state.error = '每次作业最多上传 8 个文件。'
      return
    }
    const id = activeId,
      revision = courseRevision
    const controller = new AbortController()
    request = controller
    state.busy = 'upload'
    state.error = ''
    try {
      for (const file of files) {
        const { attachment, content } = await readPracticeFile(file)
        controller.signal.throwIfAborted()
        const next = validateAttachments([...(record.attachments ?? []), attachment])
        await attachmentStore.save(id, record.id, attachment, content)
        controller.signal.throwIfAborted()
        if (courseRevision !== revision || current.value?.id !== record.id) return
        record.attachments = next
        await persist()
      }
    } catch (error) {
      if (!controller.signal.aborted) state.error = `作业文件未添加：${(error as Error).message}`
    } finally {
      if (request === controller) {
        request = null
        state.busy = ''
      }
    }
  }
  function removeAttachment(id: string) {
    if (!current.value || state.busy) return
    current.value.attachments = attachments.value.filter((file) => file.id !== id)
    state.error = ''
    persist()
  }
  function loadAttachment(file: PracticeAttachment, recordId = current.value?.id) {
    if (!activeId || !recordId) return Promise.reject(new Error('当前作业不可用。'))
    return attachmentStore.load(activeId, recordId, file)
  }

  async function open(video: VideoEntry, scope: PracticeScope | null) {
    if (!activeId) return
    cancel()
    persist()
    if (state.path !== video.path || JSON.stringify(state.scope) !== JSON.stringify(scope)) state.supplement = ''
    state.retryGenerationCount = 0
    state.path = video.path
    state.title = video.title
    state.scope = scope
    state.open = true
    state.error = ''
    state.materialNotice = ''
    state.hintError = ''
    state.note = ''
    state.cues = []
    state.preparedSources = options.sources ? [] : null
    state.selectedId = history.value.find((r) => JSON.stringify(r.scope) === JSON.stringify(scope))?.id ?? ''
    const controller = new AbortController()
    request = controller
    state.busy = 'loading'
    try {
      await historyLoad
      if (controller.signal.aborted) return
      if (!state.historyReady) await (historyLoad = loadHistory())
      if (controller.signal.aborted || !state.historyReady) return
      state.selectedId = history.value.find((r) => JSON.stringify(r.scope) === JSON.stringify(scope))?.id ?? ''
      const cues = await loadLessonSubtitles(video)
      if (controller.signal.aborted) return
      state.cues = cues
      state.note = ''
      if (options.sources) {
        const summary = await options.sources(video, scope)
        if (controller.signal.aborted) return
        state.preparedSources = summary
      }
    } catch (err) {
      if (!controller.signal.aborted) state.error = (err as Error).message
    } finally {
      if (request === controller) {
        request = null
        state.busy = ''
      }
    }
  }

  async function openSources(path: string, title: string, loader: (signal: AbortSignal) => Promise<PracticeSource[]>) {
    if (!activeId) return
    cancel()
    persist()
    state.retryGenerationCount = 0
    Object.assign(state, {
      path,
      title,
      scope: null,
      open: true,
      error: '',
      hintError: '',
      materialNotice: '',
      note: '',
      cues: [],
      supplement: '',
      preparedSources: [],
      selectedId: '',
    })
    const controller = new AbortController()
    request = controller
    state.busy = 'loading'
    try {
      await historyLoad
      if (controller.signal.aborted) return
      if (!state.historyReady) await (historyLoad = loadHistory())
      if (controller.signal.aborted || !state.historyReady) return
      state.selectedId = history.value.at(-1)?.id ?? ''
      const sources = await loader(controller.signal)
      if (!controller.signal.aborted) state.preparedSources = sources
    } catch (err) {
      if (!controller.signal.aborted) state.error = (err as Error).message
    } finally {
      if (request === controller) {
        request = null
        state.busy = ''
      }
    }
  }

  async function generate(count: number | 'auto' = 1) {
    if (state.busy || !state.open || !activeId || !state.historyReady) return
    if (mode === 'daily') {
      if (history.value.length) return
      count = 1
      state.questionCount = 1
    }
    state.error = ''
    if (!hasMaterial.value) {
      state.error = '学习材料不足，请补充本课概念、示例或代码后生成练习。'
      return
    }
    if (!configured.value) {
      state.error = '请先在 AI 设置中填写服务地址和模型。'
      return
    }
    if (count !== 'auto' && (!Number.isInteger(count) || count < 1 || count > 8)) return
    const controller = new AbortController()
    request = controller
    state.busy = 'generate'
    state.retryGenerationCount = count
    state.generationProgress = ''
    // 固定本次提交的材料，等待期间的 UI 变化不能改变题目依据。
    const submitted = sources.value.map((s) => ({ ...s }))
    const scope = state.scope ? { ...state.scope } : null
    const path = state.path
    try {
      const submittedSettings = { ...settings }
      const programmingLanguages = await availableProgrammingLanguages()
      controller.signal.throwIfAborted()
      const dailyMaterial =
        mode === 'daily'
          ? await prepareDailyPracticeSources({
              identity: { courseId: activeId, path, settings: aiTaskSettings(submittedSettings) },
              title: state.title,
              sources: submitted,
              signal: controller.signal,
              request: (messages) => requestGuideJson(submittedSettings, messages, controller.signal),
              progress: (message) => {
                state.generationProgress = message
              },
            })
          : null
      const allBatches = materialBatches(dailyMaterial?.sources ?? submitted)
      // 单题续练轮换材料批次，保证按钮始终只新增一题；整组练习覆盖全部批次。
      const batches =
        mode === 'daily'
          ? allBatches
          : count === 1
            ? [allBatches[history.value.length % allBatches.length]!]
            : allBatches
      const batchExpectedCount = typeof count === 'number' ? count : 4
      if (batches.length * batchExpectedCount > historyLimit)
        throw new Error(`知识点较多，请精简补充材料后重试（本次最多保留 ${historyLimit} 题）。`)
      const previous = history.value.map((r) => r.question)
      const identity = {
        kind: 'practice',
        promptVersion: 5,
        programmingLanguages,
        courseId: activeId,
        path,
        title: state.title,
        scope,
        count,
        mode,
        programmingPreference: state.programmingPreference,
        batches,
        previous,
        settings: aiTaskSettings(submittedSettings),
      }
      const results = await runAiBatches({
        identity,
        batches,
        signal: controller.signal,
        progress: (done, total) => {
          state.generationProgress = `已完成 ${done} / ${total} 批`
        },
        request: (batch, _index, completed: ReturnType<typeof validatePracticeQuestion>[][]) =>
          requestGuideJson(
            submittedSettings,
            practicePrompt(
              state.title,
              batch,
              scope,
              [...previous, ...completed.flat()],
              count,
              mode === 'daily',
              identity.programmingPreference,
              programmingLanguages,
            ),
            controller.signal,
          ),
        validate: async (raw, batch, _index, completed: ReturnType<typeof validatePracticeQuestion>[][]) => {
          const questions =
            count === 1
              ? [raw]
              : Array.isArray(raw)
                ? raw
                : isRecord(raw) && Array.isArray(raw.questions)
                  ? raw.questions
                  : count === 'auto' && isRecord(raw) && raw.kind
                    ? [raw]
                    : []
          if (typeof count === 'number' && count > 1 && questions.length !== count) {
            throw new Error('AI 返回的题目数量不完整，请重试。')
          }
          if ((count === 1 || count === 'auto') && !questions.length) {
            throw new Error('AI 返回的题目数量不完整，请重试。')
          }
          if (count === 'auto' && questions.length > historyLimit) {
            throw new Error('AI 返回的题目数量超出限制，请重试。')
          }
          const validated: ReturnType<typeof validatePracticeQuestion>[] = []
          for (const item of questions) {
            const question =
              mode === 'daily'
                ? validateDailyPracticeQuestion(item, batch)
                : validatePracticeQuestion(item, batch, true, true)
            const programming = programmingQuestion(question)
            if (
              mode !== 'daily' &&
              identity.programmingPreference !== 'auto' &&
              programming?.mode !== identity.programmingPreference
            )
              throw new Error('AI 返回的编程题型与所选题型不一致，请重新生成。')
            if (programming) {
              if (!programmingLanguages.includes(programming.language))
                throw new Error('本机未安装题目所需的编程环境，请在设置中重新检测。')
              state.generationProgress = '正在验证编程题'
              await verifyProgrammingExercise(programming, controller.signal, codeRunner)
            }
            if (isRepeatedPracticeQuestion(question, [...previous, ...completed.flat(), ...validated])) {
              throw new Error('AI 返回了已有题目，请重试或补充学习材料。')
            }
            validated.push(question)
          }
          return validated
        },
      })
      if (controller.signal.aborted) return
      const groupId = crypto.randomUUID()
      const pending: PracticeRecord[] = results.flatMap((questions, index) =>
        questions.map((question) => ({
          id: crypto.randomUUID(),
          groupId,
          path,
          createdAt: Date.now(),
          scope,
          sources: batches[index]!,
          question,
          draft: programmingQuestion(question)?.starterCode ?? '',
          attempts: [],
        })),
      )
      for (const record of pending) state.records = appendPracticeRecord(state.records, record, historyLimit)
      state.selectedId = pending[0]?.id ?? ''
      state.questionCount = pending.length
      state.retryGenerationCount = 0
      if (await persist()) {
        await completeAiBatches(identity)
        for (const task of dailyMaterial?.identities ?? []) await completeAiBatches(task)
      }
    } catch (err) {
      if (!controller.signal.aborted) state.error = (err as Error).message
    } finally {
      if (request === controller) {
        request = null
        state.busy = ''
      }
    }
  }

  async function review() {
    const record = current.value
    if (
      !state.open ||
      !state.historyReady ||
      !record ||
      state.busy ||
      (!programmingQuestion(record.question) && record.attempts.length >= PRACTICE_ATTEMPT_LIMIT) ||
      answerSubmitted.value
    )
      return
    state.error = ''
    const answer = practiceAnswerText(record.question, record.draft)
    const helpLevel = practiceHelpLevel(record)
    const submittedFiles = (record.attachments ?? []).map((file) => ({ ...file }))
    if (!answer.trim() && !submittedFiles.length) {
      state.error = isChoiceQuestion(record.question) ? '请选择答案后提交。' : '请填写作答内容或上传代码、图片后提交。'
      return
    }
    if (isChoiceQuestion(record.question)) {
      record.attempts.push({
        answer,
        feedback: reviewPracticeChoice(record.question, record.draft),
        at: Date.now(),
        helpLevel,
      })
      persist()
      return
    }
    if (!configured.value) {
      state.error = '请先选择有效的 AI 配置。'
      return
    }
    const controller = new AbortController()
    request = controller
    state.busy = 'review'
    try {
      const settingsSnapshot = { ...settings }
      const programming = programmingQuestion(record.question)
      let codeRun: ProgrammingRun | undefined
      if (programming) {
        codeRun = await codeRunner({ exercise: programming, code: answer, mode: 'test' }, controller.signal)
        controller.signal.throwIfAborted()
        record.codeRun = codeRun
        await persist()
      }
      const files = await Promise.all(
        submittedFiles.map(async (attachment) => ({
          attachment,
          content: await loadAttachment(attachment, record.id),
        })),
      )
      controller.signal.throwIfAborted()
      const graded = mode === 'daily' || files.length > 0 || !!programming
      const messages = codeRun
        ? programmingReviewPrompt(record, answer, codeRun)
        : graded
          ? assignmentReviewPrompt(record, answer, files)
          : practiceReviewPrompt(record, answer)
      const raw = await requestGuideJson(settingsSnapshot, messages, controller.signal)
      if (controller.signal.aborted) return
      record.attempts.push({
        answer,
        helpLevel,
        ...(submittedFiles.length ? { attachments: submittedFiles } : {}),
        feedback: validatePracticeFeedback(raw, record.sources, record.question, graded),
        at: Date.now(),
        ...(codeRun ? { codeRun } : {}),
      })
      if (programming) record.attempts = record.attempts.slice(-PROGRAMMING_HISTORY_LIMIT)
      persist()
    } catch (err) {
      if (!controller.signal.aborted) state.error = (err as Error).message
    } finally {
      if (request === controller) {
        request = null
        state.busy = ''
      }
    }
  }

  async function loadHistory() {
    const version = courseRevision,
      id = activeId
    if (!activeId) return
    try {
      const practiceMap = await fetchRecords(id)
      if (version !== courseRevision) return
      const allRecords = Object.values(practiceMap).flat()
      const videoPaths = course.value?.videos.map((v) => v.path) ?? []
      const paths =
        mode === 'daily' ? Object.keys(practiceMap).filter((p) => /^daily:\d{4}-\d{2}-\d{2}:/u.test(p)) : videoPaths
      state.records = restorePractice(
        allRecords.filter((r) => r && typeof r.createdAt === 'number').sort((a, b) => b.createdAt - a.createdAt),
        paths,
        historyLimit,
        videoPaths,
      )
      state.historyReady = true
      state.storageError = ''
    } catch {
      if (version === courseRevision) state.storageError = '练习记录读取失败，请关闭后重新打开练习重试。'
    }
  }
  watch(
    () => course.value?.id,
    () => {
      persist()
      cancel()
      attachmentStore.clear()
      courseRevision++
      state.open = false
      state.records = []
      state.selectedId = ''
      state.path = ''
      state.note = ''
      state.cues = []
      state.supplement = ''
      state.storageError = ''
      state.error = ''
      state.hintError = ''
      state.historyReady = false
      state.preparedSources = null
      activeId = course.value?.id ?? ''
      historyLoad = loadHistory()
    },
    { immediate: true, flush: 'sync' },
  )
  watch(
    () => [
      settings.provider,
      settings.contextWindow,
      settings.baseUrl,
      settings.model,
      settings.apiKey,
      settings.timeoutMinutes,
      available.value,
    ],
    () => {
      if (state.busy !== 'generate' && state.busy !== 'review' && state.busy !== 'hint') return
      const wasHint = state.busy === 'hint'
      cancel()
      if (wasHint) state.hintError = 'AI 配置已变更，请重新获取提示。'
      else state.error = 'AI 配置已变更，请重新提交请求。'
    },
    { flush: 'sync' },
  )
  onBeforeUnmount(() => {
    cancel()
    persist()
    attachmentStore.clear()
    courseRevision++
  })
  return {
    persist,
    flush,
    state,
    current,
    history,
    sources,
    hasMaterial,
    configured,
    answerSubmitted,
    canReview,
    attachments,
    addAttachments,
    removeAttachment,
    loadAttachment,
    open,
    openSources,
    close,
    cancel,
    select,
    updateDraft,
    resetCode,
    executeCode,
    revealHint,
    revealReference,
    generate,
    review,
  }
}

import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { Course } from '~/types/course'
import type { GuideMessage, GuideSettings, LearningPlan } from '~/types/guide'
import type { GuideConversationData, GuideConversationTurn, GuideCourseCatalogEntry } from '~/types/guideConversation'
import type { GuideRouteConstraints } from '~/types/guideConstraints'
import { databaseRequest } from '~/utils/database'
import { AiJsonParseError, requestGuideJson } from '~/utils/guideAi'
import { aiFormAnswerText, validateAiFormAnswers } from '~/utils/aiInteraction'
import {
  fixedCatalogRoute,
  hasRouteSelection,
  parseRouteConstraints,
  pathInScope,
  readRouteDirective,
  routeArrangement,
} from '~/utils/guideConstraints'
import {
  emptyGuideConversation,
  guideConversationKey,
  guideConversationMessages,
  guideConversationPrompt,
  parseGuideConversation,
  parseGuideTurnReply,
  GUIDE_CONVERSATION_SYSTEM,
  guideReplyCorrection,
  restoreConversationConstraints,
} from '~/utils/guideConversation'

export function useGuideConversation(options: {
  course: Ref<Course | null>
  settings: Ref<GuideSettings>
  configured: Ref<boolean>
  guideReady: Ref<boolean>
  blocked: Ref<boolean>
  plan: Ref<LearningPlan | null>
  date: Ref<string>
  catalog: Ref<GuideCourseCatalogEntry[]>
  generate: (
    text: string,
    dailyMinutes: number | null,
    completionDate: string | null,
    conversation: GuideMessage[],
    constraints?: GuideRouteConstraints,
    sessionId?: string,
  ) => Promise<boolean>
  resetPlanMessages?: (id: string) => void
}) {
  const state = reactive({
    data: emptyGuideConversation(),
    ready: false,
    loading: false,
    busy: false,
    resetting: false,
    error: '',
    storageError: '',
  })
  const question = ref('')
  const arrangement = computed(() => routeArrangement(state.data.constraints, options.catalog.value))
  const hasAnswers = () =>
    state.data.turns.some(
      (entry) => entry.reply?.form && entry.answers && Object.values(entry.answers).some((answer) => answer !== null),
    )
  const canConfirmSelection = () => hasAnswers() || state.data.constraints.includeRemaining
  function directReply(turn: GuideConversationTurn, explicit: boolean) {
    if (
      !turn.reply ||
      !canConfirmSelection() ||
      !hasRouteSelection(state.data.constraints) ||
      (!explicit && turn.replySource !== 'selection')
    )
      return
    turn.reply.form = null
    turn.replySource = 'selection'
    turn.reply.message = '按你的选择继续安排学习。'
    turn.reply.planRequest =
      '按已确认的学习范围与顺序生成完整学习计划。以用户原始问卷回答和最新要求为准，其余全部学时不再精选章节或项目。按实际观看进度接续，不让用户重选已完成课节。安排学习时间、练习和复盘，未填写的时间与周期由你建议，不再追加偏好问题。'
  }
  let activeId = '',
    revision = 0,
    taskId = 0,
    disposed = false
  let controller: AbortController | undefined
  let queue = Promise.resolve(true)
  const unsaved = new Map<string, GuideConversationData>()
  const last = computed(() => state.data.turns.at(-1))
  const initialized = computed(() => {
    const first = state.data.turns[0]
    return !!first && (first.kind !== 'initialization' || first.status === 'done')
  })
  const canPlan = computed(
    () =>
      last.value?.status === 'done' &&
      !!last.value.reply?.planRequest &&
      options.catalog.value.some((lesson) => pathInScope(lesson.path, state.data.constraints)) &&
      (!last.value.reply.form || !!last.value.answers),
  )
  function cancel() {
    taskId++
    controller?.abort()
    controller = undefined
    if (last.value?.status === 'pending') last.value.status = 'stopped'
    state.busy = false
    void save()
  }
  function save(): Promise<boolean> {
    if (!activeId || !state.ready) return Promise.resolve(true)
    const id = activeId
    const data: GuideConversationData = JSON.parse(JSON.stringify(state.data))
    unsaved.set(id, data)
    return write(id, data)
  }
  function write(id: string, data: GuideConversationData): Promise<boolean> {
    const current = revision
    const write = queue.then(async () => {
      try {
        await databaseRequest('settings', { method: 'POST', body: { key: guideConversationKey(id), value: data } })
        if (unsaved.get(id) === data) unsaved.delete(id)
        if (current === revision && id === activeId && !disposed) state.storageError = ''
        return true
      } catch {
        if (current === revision && id === activeId && !disposed) state.storageError = '导学对话保存失败，请重试。'
        return false
      }
    })
    queue = write
    return write
  }
  async function load() {
    if (!activeId || state.loading || state.ready) return
    const id = activeId,
      current = revision
    state.loading = true
    state.storageError = ''
    try {
      await queue
      const stored = parseGuideConversation(
        await databaseRequest('settings', { query: { key: guideConversationKey(id) } }),
      )
      if (current !== revision || disposed) return
      const data = unsaved.has(id) ? parseGuideConversation(unsaved.get(id)) : stored
      state.data = data
      state.data.constraints = restoreConversationConstraints(data, options.catalog.value)
      if (
        data.turns.length > 0 &&
        data.turns[0]?.kind !== 'initialization' &&
        !hasRouteSelection(state.data.constraints) &&
        state.data.constraints.order === 'ai' &&
        options.plan.value?.constraints
      )
        state.data.constraints = parseRouteConstraints(options.plan.value.constraints)
      const latest = state.data.turns.at(-1)
      if (latest?.status === 'done')
        directReply(
          latest,
          readRouteDirective(data.constraints, latest.question, options.catalog.value).explicit ||
            (fixedCatalogRoute(state.data.constraints) &&
              /起点|从.+开始|(?:没学|未学|还没学).*(?:跳过)/s.test(latest.question)),
        )
      state.ready = true
    } catch {
      if (current === revision && !disposed) state.storageError = '导学对话读取失败，请重试。'
    } finally {
      if (current === revision && !disposed) state.loading = false
    }
  }
  watch(
    options.course,
    () => {
      cancel()
      revision++
      activeId = options.course.value?.id ?? ''
      state.data = emptyGuideConversation()
      state.ready = false
      state.loading = false
      state.resetting = false
      state.error = ''
      state.storageError = ''
      question.value = ''
      void load()
    },
    { immediate: true, flush: 'sync' },
  )
  watch(() => JSON.stringify(options.settings.value), cancel, { flush: 'sync' })
  watch(options.configured, cancel, { flush: 'sync' })
  watch(options.date, cancel, { flush: 'sync' })
  watch(() => JSON.stringify(options.catalog.value.map((lesson) => [lesson.path, lesson.title])), cancel, {
    flush: 'sync',
  })
  watch(
    options.blocked,
    (blocked) => {
      if (blocked) cancel()
    },
    { flush: 'sync' },
  )

  async function send(
    input: string,
    retryId?: string,
    submission?: { turn: GuideConversationTurn; answers: unknown },
    initializing = false,
  ) {
    if (
      disposed ||
      state.busy ||
      state.resetting ||
      options.blocked.value ||
      !state.ready ||
      !options.guideReady.value ||
      !activeId
    )
      return false
    if (!options.configured.value) {
      state.error = '请先配置 AI 服务。'
      return false
    }
    if (!input.trim() || input.length > 40000) {
      state.error = '请输入学习背景与目标。'
      return false
    }
    if (!initializing && !state.data.turns.length && options.plan.value?.constraints)
      state.data.constraints = parseRouteConstraints(options.plan.value.constraints)
    const retry = retryId ? last.value : undefined
    if (retryId && (retry?.id !== retryId || !['error', 'stopped'].includes(retry.status))) return false
    if (!retry && state.data.turns.length >= 100) {
      state.error = '本次对话较长，请根据已确认方案生成路线。'
      return false
    }
    try {
      if (submission?.turn.reply?.form)
        submission.turn.answers = validateAiFormAnswers(submission.turn.reply.form, submission.answers)
    } catch (error) {
      state.error = (error as Error).message
      return false
    }
    const directive = readRouteDirective(state.data.constraints, input, options.catalog.value)
    state.data.constraints = directive.constraints
    if (!retry)
      state.data.turns.push({
        id: crypto.randomUUID(),
        ...(initializing ? { kind: 'initialization' as const } : {}),
        question: input.trim(),
        reply: null,
        status: 'pending',
        error: '',
      })
    const turn = last.value!
    turn.status = 'pending'
    turn.error = ''
    state.busy = true
    state.error = ''
    if (!retry) question.value = ''
    const id = activeId,
      token = ++taskId
    const abort = new AbortController()
    controller = abort
    void save()
    try {
      const correctingStart =
        fixedCatalogRoute(state.data.constraints) && /起点|从.+开始|(?:没学|未学|还没学).*(?:跳过)/s.test(input)
      if (
        canConfirmSelection() &&
        hasRouteSelection(state.data.constraints) &&
        (directive.explicit || correctingStart)
      ) {
        turn.reply = { message: '', profile: state.data.profile, form: null, planRequest: null }
        turn.status = 'done'
        directReply(turn, true)
        return true
      }
      const settings = { ...options.settings.value }
      const messages = guideConversationPrompt({
        courseName: options.course.value!.name,
        catalog: options.catalog.value,
        previous: options.plan.value,
        data: state.data,
        today: options.date.value,
      })
      const isCurrent = () => token === taskId && id === activeId && !disposed && !abort.signal.aborted
      const initializing = turn.kind === 'initialization'
      let raw: unknown
      let received = false
      let reply
      try {
        raw = await requestGuideJson(settings, messages, abort.signal, { system: GUIDE_CONVERSATION_SYSTEM })
        received = true
        if (!isCurrent()) return false
        reply = parseGuideTurnReply(raw, initializing)
      } catch (error) {
        if (!isCurrent()) return false
        if (!received && !(error instanceof AiJsonParseError)) throw error
        // Correct completed content once, including invalid JSON; never replay transport failures or cancellation.
        const corrected = await requestGuideJson(
          settings,
          [...messages, guideReplyCorrection(error instanceof AiJsonParseError ? error.content : raw, initializing)],
          abort.signal,
          { system: GUIDE_CONVERSATION_SYSTEM },
        )
        if (!isCurrent()) return false
        reply = parseGuideTurnReply(corrected, initializing)
      }
      turn.reply = reply
      turn.status = 'done'
      directReply(turn, directive.explicit)
      if (reply.profile) state.data.profile = reply.profile
      return true
    } catch (error) {
      if (token === taskId && id === activeId && !disposed) {
        turn.status = 'error'
        turn.error = error instanceof Error ? error.message : 'AI 导学回复失败，请重试。'
      }
      return false
    } finally {
      if (token === taskId && id === activeId && !disposed) {
        state.busy = false
        controller = undefined
        void save()
      }
    }
  }
  function initialize() {
    if (state.data.turns.length) return Promise.resolve(false)
    return send('AI 定制初始化', undefined, undefined, true)
  }
  function ask(retryId?: string) {
    if (!retryId && !initialized.value) return Promise.resolve(false)
    if (!retryId && question.value.length > 6000) {
      state.error = '消息请控制在 6000 字以内。'
      return Promise.resolve(false)
    }
    return send(retryId ? (last.value?.question ?? '') : question.value, retryId)
  }
  function submitForm(turnId: string, raw: unknown) {
    const turn = last.value
    if (!turn || turn.id !== turnId || turn.status !== 'done' || !turn.reply?.form || turn.answers)
      return Promise.resolve(false)
    try {
      const answers = validateAiFormAnswers(turn.reply.form, raw)
      return send(aiFormAnswerText(turn.reply.form, answers), undefined, { turn, answers })
    } catch (error) {
      state.error = (error as Error).message
      return Promise.resolve(false)
    }
  }
  async function generatePlan() {
    if (!canPlan.value || state.busy || options.blocked.value || !state.ready) return false
    try {
      const id = activeId,
        token = taskId
      if (!(await save())) return false
      if (id !== activeId || token !== taskId || disposed || options.blocked.value) return false
      return await options.generate(
        last.value!.reply!.planRequest!,
        null,
        null,
        guideConversationMessages(state.data),
        state.data.constraints,
        state.data.turns[0]?.kind === 'initialization' ? state.data.turns[0].id : undefined,
      )
    } catch (error) {
      state.error = (error as Error).message
      return false
    }
  }
  async function reset() {
    if (disposed || !state.ready || state.resetting || options.blocked.value || !activeId) return false
    cancel()
    const id = activeId,
      token = taskId
    state.resetting = true
    state.data = emptyGuideConversation()
    question.value = ''
    state.error = ''
    try {
      if (!(await save())) return false
      if (id !== activeId || token !== taskId || disposed) return false
      options.resetPlanMessages?.(id)
      return true
    } finally {
      if (id === activeId && token === taskId && !disposed) state.resetting = false
    }
  }
  async function flush() {
    cancel()
    if (!(await save())) throw new Error('导学对话保存失败，请重试。')
    for (const [id, data] of unsaved) {
      if (!(await write(id, data))) throw new Error('导学对话保存失败，请重试。')
    }
    await queue
  }
  onBeforeUnmount(() => {
    cancel()
    disposed = true
  })
  return {
    state,
    question,
    arrangement,
    initialize,
    initialized,
    canPlan,
    ask,
    submitForm,
    generatePlan,
    cancel,
    load,
    save,
    flush,
    reset,
  }
}

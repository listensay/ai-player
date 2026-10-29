import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { Course, VideoEntry } from '~/types/course'
import type { AiProfile, GuideSettings } from '~/types/guide'
import type { AssistantSession, AssistantTurn } from '~/types/learningAssistant'
import type { usePlayer } from './usePlayer'
import type { useTranscripts } from './useTranscripts'
import type { useLessonKnowledge } from './useLessonKnowledge'
import { databaseRequest } from '~/utils/database'
import { createAiChatHistory, AI_CHAT_HISTORY_KEY } from '~/utils/aiChatHistory'
import { requestAiText } from '~/utils/guideAi'
import { learningContext, chatSystem, chatMessages } from '~/utils/learningAssistant'

export function useLearningAssistant(options: {
  course: Ref<Course | null>
  video: Ref<VideoEntry | null>
  active: Ref<boolean>
  activeProfileId: Ref<string>
  profiles: Ref<AiProfile[]>
  ready: Ref<boolean>
  player: ReturnType<typeof usePlayer>
  transcripts: ReturnType<typeof useTranscripts>
  knowledge: ReturnType<typeof useLessonKnowledge>
  reveal: () => void
  notify: (text: string) => void
  history?: ReturnType<typeof createAiChatHistory>
}) {
  const key = computed(() =>
    options.course.value && options.video.value
      ? JSON.stringify([options.course.value.id, options.video.value.path])
      : '',
  )
  const history =
    options.history ??
    createAiChatHistory({
      read: () => databaseRequest('settings', { query: { key: AI_CHAT_HISTORY_KEY } }),
      write: (value) => databaseRequest('settings', { method: 'POST', body: { key: AI_CHAT_HISTORY_KEY, value } }),
    })
  const conversation = ref<AssistantSession | null>(null)
  const turns = computed(() => conversation.value?.turns ?? [])
  const canReply = computed(
    () =>
      !conversation.value ||
      (conversation.value.courseId === options.course.value?.id &&
        conversation.value.path === options.video.value?.path),
  )
  const conversations = computed(() => [...history.state.sessions].sort((a, b) => b.updatedAt - a.updatedAt))
  function saveConversation() {
    if (!conversation.value?.turns.length) return
    conversation.value.updatedAt = Date.now()
    void history.save(conversation.value)
  }
  const question = ref(''),
    busy = ref(false),
    error = ref(''),
    selectedModel = ref('')
  const choices = computed(() =>
    options.profiles.value.flatMap((profile) =>
      [...new Set([...(profile.modelIds ?? []), profile.model].map((model) => model.trim()).filter(Boolean))].map(
        (model) => ({
          value: JSON.stringify([profile.id, model]),
          title: `${model} · ${profile.name}`,
          settings: {
            provider: profile.provider,
            contextWindow: profile.contextWindow,
            baseUrl: profile.baseUrl,
            apiKey: profile.apiKey,
            timeoutMinutes: profile.timeoutMinutes,
            model,
          } satisfies GuideSettings,
        }),
      ),
    ),
  )
  const modelOptions = computed(() => choices.value.map(({ value, title }) => ({ value, title })))
  watch(
    choices,
    (items) => {
      if (!items.some((item) => item.value === selectedModel.value)) {
        const profile = options.profiles.value.find((item) => item.id === options.activeProfileId.value)
        selectedModel.value =
          items.find((item) => item.value === JSON.stringify([profile?.id, profile?.model]))?.value ??
          items[0]?.value ??
          ''
      }
    },
    { immediate: true, flush: 'sync' },
  )
  const selected = computed(() => choices.value.find((item) => item.value === selectedModel.value))
  const configured = computed(
    () => options.ready.value && !!selected.value?.settings.baseUrl && !!selected.value.settings.model,
  )
  let controller: AbortController | undefined,
    taskId = 0,
    pending: AssistantTurn | undefined

  function cancel() {
    taskId++
    controller?.abort()
    controller = undefined
    if (pending?.status === 'pending') {
      pending.status = 'stopped'
      saveConversation()
    }
    pending = undefined
    busy.value = false
  }
  function reset() {
    cancel()
    conversation.value = null
    question.value = ''
    error.value = ''
  }
  function selectConversation(id: string) {
    cancel()
    const saved = history.state.sessions.find((session) => session.id === id)
    if (!saved) return
    // A copy isolates the active view from asynchronous history writes.
    conversation.value = JSON.parse(JSON.stringify(saved)) as AssistantSession
    question.value = ''
    error.value = ''
  }
  watch(key, reset, { flush: 'sync' })
  watch(
    options.active,
    (active) => {
      if (!active) cancel()
    },
    { flush: 'sync' },
  )
  // Replacing credentials or deleting a profile invalidates an in-flight request.
  watch(() => JSON.stringify(options.profiles.value), cancel, { flush: 'sync' })
  function open() {
    if (!key.value || !options.active.value) {
      options.notify('请先在播放器打开课节。')
      return
    }
    options.reveal()
  }
  async function ask(retryId?: string) {
    if (busy.value || !canReply.value) return
    const retry = retryId ? turns.value.find((turn) => turn.id === retryId) : undefined
    if (retryId && (!retry || retry !== turns.value.at(-1) || !['error', 'stopped'].includes(retry.status))) return
    const input = (retry?.question ?? question.value).trim()
    if (!input || input.length > 4000) {
      error.value = '请输入 1–4000 字的消息。'
      return
    }
    if (!configured.value || !selected.value) {
      error.value = '请先配置 AI 模型。'
      return
    }
    const course = options.course.value,
      video = options.video.value
    if (!course || !video || !options.active.value) return
    const settings = { ...selected.value.settings }
    const ctx = learningContext({
      courseId: course.id,
      path: video.path,
      title: video.title,
      seconds: retry?.seconds ?? options.player.state.currentTime,
      duration: options.player.state.duration,
      segments: options.transcripts.get(course.id, video.path).segments,
      points: options.knowledge.get(course.id, video.path).summary?.points ?? [],
    })
    const messages = chatMessages(turns.value, input)
    if (!conversation.value) {
      conversation.value = {
        id: crypto.randomUUID(),
        courseId: course.id,
        path: video.path,
        courseName: course.name ?? '',
        videoTitle: video.title,
        title: input.replace(/\s+/gu, ' ').slice(0, 80),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        turns: [],
      }
    }
    if (!retry) {
      turns.value.push({
        id: crypto.randomUUID(),
        question: input,
        markdown: '',
        seconds: ctx.seconds,
        model: settings.model,
        status: 'pending',
        error: '',
      })
      question.value = ''
    }
    const turn = retry ?? turns.value.at(-1)!
    Object.assign(turn, { status: 'pending', error: '', model: settings.model })
    pending = turn
    saveConversation()
    error.value = ''
    busy.value = true
    const expected = key.value,
      token = ++taskId
    controller = new AbortController()
    try {
      const answer = await requestAiText(settings, messages, controller.signal, chatSystem(ctx))
      if (token !== taskId || expected !== key.value || !options.active.value) return
      if (!answer.trim()) throw Error('AI 未返回内容，请重试。')
      turn.markdown = answer
      turn.status = 'done'
    } catch (reason) {
      if (token === taskId && expected === key.value) {
        turn.status = 'error'
        turn.error = reason instanceof Error ? reason.message : '发送失败，请重试。'
      }
    } finally {
      if (token === taskId) {
        saveConversation()
        busy.value = false
        controller = undefined
        pending = undefined
      }
    }
  }
  async function copyResult(markdown: string) {
    try {
      await navigator.clipboard.writeText(markdown)
      options.notify('已复制')
    } catch {
      error.value = '复制失败，请重试。'
    }
  }
  onMounted(() => void history.load())
  onBeforeUnmount(cancel)
  async function flush() {
    cancel()
    await history.flush()
  }
  return {
    question,
    turns,
    busy,
    error,
    selectedModel,
    modelOptions,
    configured,
    open,
    ask,
    cancel,
    reset,
    copyResult,
    history,
    conversations,
    conversation,
    canReply,
    selectConversation,
    flush,
  }
}

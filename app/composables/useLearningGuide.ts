import type { Course, VideoEntry } from '~/types/course'
import type { ConceptMastery, FallbackRecommendation, GuideSettings, LearningPlan, LearningQuestion, LessonMetadata, LessonStatus, MasteryLevel, QuestionStatus, SubtitleCue, TodayPlan } from '~/types/guide'
import { adjacentRoutePath, buildSchedule, dependencyRisks, isRecord, orderedRoute, retainPrerequisites, validateLearningPlan } from '~/utils/guide'
import { completionUrl, planPrompt, requestGuideJson } from '~/utils/guideAi'
import { collectGuideMetadata, loadLessonSubtitles, relevantCues } from '~/utils/guideMedia'
import { applyMastery, buildTodayPlan, lessonConcepts, lessonMastery, localDayKey, masteryKey, restoreFeedback } from '~/utils/learningFeedback'
import { dbFetchGuide, dbFetchSetting, dbSaveGuide, dbSaveSetting } from '~/utils/dbClient'

const OLD_STORAGE_PREFIX = 'ai-player.guide.v1.'
const OLD_SETTINGS_KEY = 'ai-player.ai-settings.v1'
const GUIDE_KEY = Symbol('learning-guide')

export function useLearningGuide(course: Ref<Course | null>) {
  const progress = useProgress()
  const state = reactive({
    plan: null as LearningPlan | null,
    metadata: {} as Record<string, LessonMetadata>,
    view: 'all' as 'all' | 'route',
    includeOptional: false,
    busy: '' as '' | 'plan' | 'fallback',
    error: '', storageError: '', notice: '',
    scanning: false, scanned: 0,
    recommendations: [] as FallbackRecommendation[],
    fallbackMessage: '', fallbackQuestion: '', fallbackSource: '',
    mastery: {} as Record<string, ConceptMastery>,
    questions: [] as LearningQuestion[],
    activeQuestionId: '',
    today: null as TodayPlan | null,
    settings: { baseUrl: '', model: '', apiKey: '', timeoutMinutes: 15 } as GuideSettings,
  })
  let activeId = ''
  let activePaths: string[] = []
  let request: AbortController | null = null
  let scanner: AbortController | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const todayDate = ref(localDayKey())
  let dayTimer: ReturnType<typeof setInterval> | undefined

  function persist() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    if (!activeId) return
    void dbSaveGuide({
      courseId: activeId,
      plan: state.plan,
      metadata: state.metadata,
      view: state.view,
      includeOptional: state.includeOptional,
      mastery: state.mastery,
      questions: state.questions,
      today: state.today,
    })
  }

  function cancel() {
    request?.abort()
    request = null
    state.busy = ''
  }

  const lessonMap = computed(() => new Map(state.plan?.lessons.map(l => [l.path, l]) ?? []))
  const masteredPaths = computed(() => new Set((state.plan?.lessons ?? []).filter(l => lessonMastery(l, state.mastery) === 'mastered').map(l => l.path)))
  const unresolvedQuestions = computed(() => state.questions.filter(q => q.status !== 'resolved'))
  const activeQuestion = computed(() => state.questions.find(q => q.id === state.activeQuestionId))
  const route = computed(() => orderedRoute(state.plan?.lessons ?? [], state.includeOptional))
  const routePaths = computed(() => route.value.map(l => l.path))
  const videoMap = computed(() => new Map(course.value?.videos.map(v => [v.path, v]) ?? []))
  const durations = computed(() => Object.fromEntries((course.value?.videos ?? []).map(v => [
    v.path, progress.get(course.value!.id, v.path)?.duration || state.metadata[v.path]?.duration || null,
  ])))
  const schedule = computed(() => buildSchedule(route.value, durations.value,
    course.value ? progress.courseProgress(course.value.id) : {}, state.plan?.dailyMinutes ?? 120))
  const risks = computed(() => dependencyRisks(state.plan?.lessons ?? [], state.includeOptional, masteredPaths.value))
  const firstLesson = computed(() => route.value.find(l => !progress.get(activeId, l.path)?.done) ?? route.value[0])
  const counts = computed(() => {
    const lessons = state.plan?.lessons ?? []
    return { required: lessons.filter(l => l.status === 'required').length,
      optional: lessons.filter(l => l.status === 'optional').length, skipped: lessons.filter(l => l.status === 'skipped').length }
  })
  const configured = computed(() => !!state.settings.baseUrl.trim() && !!state.settings.model.trim())

  function saveSettings(settings: GuideSettings) {
    completionUrl(settings.baseUrl)
    if (!settings.model.trim()) throw new Error('请填写模型名称。')
    const timeout = Math.min(Math.max(Number(settings.timeoutMinutes) || 15, 1), 30)
    settings.timeoutMinutes = timeout
    Object.assign(state.settings, settings)
    // AI 设置与 API 密钥统一持久化到 SQLite 数据库中
    void dbSaveSetting('ai_settings', {
      baseUrl: settings.baseUrl.trim(),
      model: settings.model.trim(),
      apiKey: settings.apiKey.trim(),
      timeoutMinutes: timeout,
    })
  }

  async function generate(text: string, dailyMinutes: number) {
    const current = course.value
    if (!current || state.busy) return false
    if (!text.trim()) { state.error = '先说说你已掌握什么，以及这次想学会什么。'; return false }
    if (text.length > 6000) { state.error = '学习要求请控制在 6000 字以内。'; return false }
    if (!Number.isFinite(dailyMinutes) || dailyMinutes < 5 || dailyMinutes > 1440) {
      state.error = '每日学习时间应为 5–1440 分钟。'; return false
    }
    const controller = new AbortController()
    request = controller
    state.busy = 'plan'; state.error = ''; state.notice = ''
    try {
      const previous = state.plan
      const raw = await requestGuideJson({ ...state.settings }, planPrompt(current.videos.map(v => ({
        path: v.path, title: v.title, duration: durations.value[v.path] ?? null, done: !!progress.get(current.id, v.path)?.done,
      })), text.trim(), dailyMinutes, previous, { mastery: Object.values(state.mastery), questions: state.questions.map(q => ({ path: q.path, text: q.text, status: q.status })) }), controller.signal)
      if (controller.signal.aborted || current.id !== activeId) return false
      const plan = validateLearningPlan(raw, current.videos.map(v => v.path))
      const promoted = retainPrerequisites(plan.lessons, false, masteredPaths.value)
      applyMastery(plan.lessons, state.mastery)
      plan.messages = [...(previous?.messages ?? []).slice(-18), { role: 'user', content: text.trim() }, { role: 'assistant', content: plan.summary }]
      state.plan = plan
      state.view = 'route'
      state.includeOptional = false
      state.recommendations = []; state.fallbackMessage = ''
      state.notice = promoted.length ? `已自动保留 ${promoted.length} 节关键前置课，避免跳过后影响后续学习。` : '路线已生成，可按自己的掌握情况调整课节。'
      persist()
      return true
    } catch (err) {
      if (!controller.signal.aborted) state.error = (err as Error).message
      return false
    } finally {
      if (request === controller) { request = null; state.busy = '' }
    }
  }

  function previewStatus(path: string, status: LessonStatus) {
    const lessons = state.plan?.lessons.map(l => ({ ...l, status: l.path === path ? status : l.status })) ?? []
    return dependencyRisks(lessons, state.includeOptional, masteredPaths.value)
  }

  function setStatus(path: string, status: LessonStatus) {
    if (!state.plan || state.busy) return
    const lesson = lessonMap.value.get(path)
    if (!lesson) return
    if (lesson.status === 'required' && status !== 'required' && counts.value.required === 1) {
      state.error = '路线至少需要保留一节必修课。'; return
    }
    lesson.status = status
    state.error = ''
  }

  function setDailyMinutes(minutes: number) {
    if (!state.plan || state.busy) return false
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
      state.error = '每日学习时间应为 5–1440 的整数分钟。'
      return false
    }
    state.plan.dailyMinutes = minutes
    state.error = ''
    return true
  }

  function repairDependencies() {
    if (!state.plan || state.busy) return
    const lessons = state.plan.lessons.map(l => ({ ...l }))
    const promoted = retainPrerequisites(lessons, state.includeOptional, masteredPaths.value)
    state.plan.lessons = lessons
    state.notice = `已将 ${promoted.length} 节前置课加入必修路线。`
  }

  function adjacent(currentPath: string, offset: -1 | 1): VideoEntry | undefined {
    const catalog = course.value?.videos.map(v => v.path) ?? []
    const paths = state.view === 'route' && state.plan ? routePaths.value : catalog
    const path = adjacentRoutePath(paths, currentPath, offset, catalog)
    return path ? videoMap.value.get(path) : undefined
  }

  function setMastery(path: string, concept: string, level: MasteryLevel | '') {
    const lesson = lessonMap.value.get(path)
    if (!lesson || state.busy || !lessonConcepts(lesson).includes(concept)) return
    const key = masteryKey(path, concept)
    if (level) state.mastery[key] = { path, concept, level, updatedAt: Date.now() }
    else delete state.mastery[key]
    // 撤回标记时保守回到查漏，关键前置课仍会被保留。
    if (!level && lesson.status === 'skipped') lesson.status = 'optional'
    applyMastery(state.plan!.lessons, state.mastery)
    state.notice = '已根据你的掌握程度更新路线，观看记录保持独立。'
    persist()
  }

  /** 练习仅记录用户主动确认的本题知识点，支持尚未生成路线的课程。 */
  function setPracticeMastery(path: string, concepts: string[], level: MasteryLevel | '') {
    if (!videoMap.value.has(path) || state.busy) return
    for (const concept of concepts.slice(0, 5)) {
      if (!concept.trim() || concept.length > 200) continue
      const key = masteryKey(path, concept)
      if (level) state.mastery[key] = { path, concept, level, updatedAt: Date.now() }
      else delete state.mastery[key]
    }
    if (state.plan) {
      const lesson = lessonMap.value.get(path)
      if (!level && lesson?.status === 'skipped') lesson.status = 'optional'
      applyMastery(state.plan.lessons, state.mastery)
    }
    persist()
  }

  function saveQuestion(text: string, path: string, seconds: number, id?: string) {
    if (!videoMap.value.has(path) || !text.trim() || text.trim().length > 3000 || !Number.isFinite(seconds)) return undefined
    const value = text.trim()
    const existing = state.questions.find(q => q.id === id)
      ?? state.questions.find(q => q.path === path && q.text === value && Math.abs(q.seconds - seconds) < 2)
    if (existing) {
      if (existing.text !== value) {
        existing.text = value; existing.status = 'open'; existing.recommendations = []; existing.reviewedPaths = []
      }
      existing.updatedAt = Date.now()
      return existing
    }
    const question: LearningQuestion = { id: crypto.randomUUID(), path, seconds: Math.max(0, seconds), text: value,
      status: 'open', createdAt: Date.now(), updatedAt: Date.now(), recommendations: [], reviewedPaths: [] }
    state.questions.unshift(question)
    persist()
    return state.questions[0]
  }

  function selectQuestion(id: string) {
    const question = state.questions.find(q => q.id === id)
    if (!question || state.busy) return
    state.activeQuestionId = id
    state.recommendations = question.recommendations
    state.fallbackQuestion = question.text; state.fallbackSource = question.path
    state.fallbackMessage = question.recommendations.length ? '上次为这个疑问找到的基础课。' : ''
  }

  function markQuestionReview(id: string, path: string) {
    const question = state.questions.find(q => q.id === id)
    if (question?.recommendations.some(r => r.path === path) && !question.reviewedPaths.includes(path)) question.reviewedPaths.push(path)
  }

  function setQuestionStatus(id: string, status: QuestionStatus) {
    const question = state.questions.find(q => q.id === id)
    if (!question || state.busy) return
    question.status = status; question.updatedAt = Date.now()
    if (status === 'still-confused' && state.plan) {
      for (const path of question.reviewedPaths) {
        const lesson = lessonMap.value.get(path)
        if (lesson) for (const concept of lessonConcepts(lesson)) {
          state.mastery[masteryKey(path, concept)] = { path, concept, level: 'needs-review', updatedAt: Date.now() }
        }
      }
      applyMastery(state.plan.lessons, state.mastery)
      state.notice = question.reviewedPaths.length ? '已把回看后仍不理解的基础课加入补学路线。' : '疑问已保留，可以继续描述卡住的知识点。'
    }
    if (status === 'resolved' && state.today) {
      for (const item of state.today.items) if (item.questionId === id) item.done = true
    }
    persist()
  }

  function refreshToday(override: number | null | undefined = undefined) {
    if (!course.value) return
    todayDate.value = localDayKey()
    const previous = state.today?.date === todayDate.value ? state.today : null
    const selected = override === undefined ? previous?.override ?? null : override
    const minutes = selected ?? state.plan?.dailyMinutes ?? 30
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) { state.error = '今日时间应为 5–1440 的整数分钟。'; return }
    state.today = buildTodayPlan(route.value, durations.value, progress.courseProgress(course.value.id), state.mastery,
      state.questions, minutes, todayDate.value, previous, selected)
  }

  function completeTodayItem(id: string, done: boolean) {
    const item = state.today?.items.find(i => i.id === id)
    if (!item) return
    item.done = done
    persist()
  }

  async function findFallback(question: string, currentVideo: VideoEntry, seconds = 0, questionId?: string) {
    const current = course.value
    if (!current || state.busy) return
    if (!state.plan) { state.error = '先生成定制路线，再根据疑问寻找之前跳过的基础课。'; return }
    if (!question.trim()) { state.error = '请描述卡住的知识点，或在笔记中选中一段疑问。'; return }
    if (question.length > 3000) { state.error = '请将疑问精简到 3000 字以内。'; return }
    const entry = saveQuestion(question, currentVideo.path, seconds, questionId)
    if (!entry) return
    state.activeQuestionId = entry.id
    const candidates = state.plan.lessons.filter(l => (l.status === 'skipped' || entry.reviewedPaths.includes(l.path)) && (videoMap.value.get(l.path)?.index ?? Infinity) < currentVideo.index)
    state.error = ''; state.recommendations = []; state.fallbackMessage = ''
    state.fallbackQuestion = question.trim(); state.fallbackSource = currentVideo.path
    if (!candidates.length) { entry.recommendations = []; state.fallbackMessage = '这节课之前没有已跳过的基础课。可以在完整目录中查漏，或补充目标重新规划。'; return }
    const controller = new AbortController()
    request = controller; state.busy = 'fallback'
    try {
      const raw = await requestGuideJson({ ...state.settings }, [{ role: 'user', content: `根据疑问，从此前跳过的课节中推荐最多 3 节需要回看的基础课。只选直接相关的课节，没有匹配则返回空数组。keywords 为用于在字幕中检索的 2–5 个具体关键词。不要返回时间点。
返回 JSON：{"recommendations":[{"path":"候选课节原路径","reason":"与疑问的关系","keywords":["反射"]}]}
输入数据：${JSON.stringify({ question: question.trim(), current: currentVideo.title, profile: state.plan.profile, candidates })}` }], controller.signal)
      if (!isRecord(raw) || !Array.isArray(raw.recommendations)) throw new Error('AI 未返回有效的回溯建议，请重试。')
      const candidatesByPath = new Map(candidates.map(l => [l.path, l]))
      const seen = new Set<string>()
      const recommendations = raw.recommendations.slice(0, 3).map((item: unknown) => {
        if (!isRecord(item) || typeof item.path !== 'string' || !candidatesByPath.has(item.path) || seen.has(item.path)
          || typeof item.reason !== 'string' || !item.reason.trim()) throw new Error('AI 推荐的课节不在已跳过的候选中，请重试。')
        seen.add(item.path)
        return { path: item.path, reason: item.reason.slice(0, 2000), keywords: Array.isArray(item.keywords)
          ? item.keywords.filter((k): k is string => typeof k === 'string').slice(0, 5) : candidatesByPath.get(item.path)!.concepts }
      })
      const evidence = new Map<string, SubtitleCue[]>()
      await Promise.all(recommendations.map(async rec => {
        const video = videoMap.value.get(rec.path)
        if (!video) return
        const cues = await loadLessonSubtitles(video)
        const duration = durations.value[rec.path]
        evidence.set(rec.path, relevantCues(cues.filter(c => !duration || c.end <= duration + 1), rec.keywords))
      }))
      if (controller.signal.aborted || current.id !== activeId) return
      const result: FallbackRecommendation[] = recommendations.map(({ path, reason }) => ({ path, reason }))
      let segmentWarning = ''
      if ([...evidence.values()].some(cues => cues.length)) {
        try {
          const segments = await requestGuideJson({ ...state.settings }, [{ role: 'user', content: `为疑问选择每节课最相关的一条字幕作为回看起点。只能引用提供的 cueId；不相关的返回 null。不要自行生成时间戳。
返回 JSON：{"segments":[{"path":"课节原路径","cueId":0}]}
输入数据：${JSON.stringify({ question, evidence: [...evidence].map(([path, cues]) => ({ path, cues: cues.map(c => ({ cueId: c.id, text: c.text })) })) })}` }], controller.signal)
          if (!isRecord(segments) || !Array.isArray(segments.segments)) throw new Error('AI 的片段定位格式不正确，请重试。')
          const verified = new Map<string, SubtitleCue>()
          const selectedPaths = new Set<string>()
          for (const segment of segments.segments) {
            if (!isRecord(segment) || typeof segment.path !== 'string' || !evidence.has(segment.path)) throw new Error('AI 引用了不存在的字幕证据。')
            if (selectedPaths.has(segment.path)) throw new Error('AI 返回了重复的字幕定位。')
            selectedPaths.add(segment.path)
            if (segment.cueId === null) continue
            const cue = evidence.get(segment.path)?.find(c => c.id === segment.cueId)
            if (!cue) throw new Error('AI 引用了不存在的字幕片段，未应用此建议。')
            verified.set(segment.path, cue)
          }
          // 全部证据通过校验后才应用，避免残缺响应留下部分时间点。
          for (const rec of result) rec.cue = verified.get(rec.path)
        } catch (err) {
          if (controller.signal.aborted) throw err
          segmentWarning = '已找到相关基础课，字幕定位暂时不可用，可先从课首回看。'
        }
      }
      if (controller.signal.aborted || current.id !== activeId) return
      state.recommendations = result
      entry.recommendations = result
      state.fallbackMessage = segmentWarning || (result.length ? '先补上这个知识点，再回到当前课程。' : '没有找到足够相关的已跳过课节。试着补充具体术语或换一种问法。')
    } catch (err) {
      if (!controller.signal.aborted) state.error = (err as Error).message
    } finally { if (request === controller) { request = null; state.busy = '' } }
  }

  function exportPlan() {
    if (!state.plan || !course.value) return
    const blob = new Blob([JSON.stringify({ course: course.value.name, plan: state.plan, mastery: state.mastery, questions: state.questions, today: state.today }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${course.value.name}-学习路线.json`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (import.meta.client) {
    void (async () => {
      try {
        const settings = await dbFetchSetting<GuideSettings>('ai_settings')
        if (settings && isRecord(settings)) {
          state.settings.baseUrl = typeof settings.baseUrl === 'string' ? settings.baseUrl : ''
          state.settings.model = typeof settings.model === 'string' ? settings.model : ''
          state.settings.apiKey = typeof settings.apiKey === 'string' ? settings.apiKey : ''
          state.settings.timeoutMinutes = typeof settings.timeoutMinutes === 'number'
            ? Math.min(Math.max(settings.timeoutMinutes, 1), 30)
            : 15
        } else {
          // 迁移旧 localStorage
          try {
            const old = JSON.parse(localStorage.getItem(OLD_SETTINGS_KEY) ?? 'null')
            if (isRecord(old)) {
              state.settings.baseUrl = typeof old.baseUrl === 'string' ? old.baseUrl : ''
              state.settings.model = typeof old.model === 'string' ? old.model : ''
              void dbSaveSetting('ai_settings', { ...state.settings })
            }
            localStorage.removeItem(OLD_SETTINGS_KEY)
          } catch { /* 忽略 */ }
        }
      } catch { /* 使用默认配置 */ }
    })()
  }

  watch(() => course.value?.id, async () => {
    persist(); cancel(); scanner?.abort()
    const current = course.value
    activeId = current?.id ?? ''; activePaths = current?.videos.map(v => v.path) ?? []
    Object.assign(state, { plan: null, metadata: {}, view: 'all', includeOptional: false, scanned: 0, scanning: false,
      error: '', storageError: '', notice: '', recommendations: [], fallbackMessage: '', fallbackQuestion: '', fallbackSource: '',
      mastery: {}, questions: [], today: null, activeQuestionId: '' })
    if (!current) return
    try {
      let stored = await dbFetchGuide(current.id) as any
      // 迁移旧 localStorage
      if (!stored && import.meta.client) {
        try {
          const old = JSON.parse(localStorage.getItem(OLD_STORAGE_PREFIX + current.id) ?? 'null')
          if (isRecord(old)) {
            stored = old
            void dbSaveGuide({ courseId: current.id, ...old } as any)
            localStorage.removeItem(OLD_STORAGE_PREFIX + current.id)
          }
        } catch { /* 忽略 */ }
      }

      if (isRecord(stored)) {
        Object.assign(state, restoreFeedback(stored, activePaths))
        if (isRecord(stored.metadata)) {
          for (const path of activePaths) {
            const entry = stored.metadata[path]
            if (isRecord(entry) && typeof entry.size === 'number' && typeof entry.modified === 'number'
              && (entry.duration === null || (typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration > 0))) {
              state.metadata[path] = { size: entry.size, modified: entry.modified, duration: entry.duration }
            }
          }
        }
        if (stored.plan) {
          const plan = validateLearningPlan(stored.plan, activePaths, true)
          if (isRecord(stored.plan) && Array.isArray(stored.plan.messages)) {
            plan.messages = stored.plan.messages.filter(m => isRecord(m) && ['user', 'assistant'].includes(String(m.role)) && typeof m.content === 'string').slice(-20)
            if (typeof stored.plan.createdAt === 'number') plan.createdAt = stored.plan.createdAt
          }
          state.plan = plan; state.view = stored.view === 'route' ? 'route' : 'all'; state.includeOptional = stored.includeOptional === true
        }
      }
    } catch { state.notice = '原路线数据读取异常，可重新生成；观看进度仍可使用。' }
    const controller = new AbortController()
    scanner = controller; state.scanning = true
    void collectGuideMetadata(current.videos, state.metadata, controller.signal, (path, metadata) => {
      state.metadata[path] = metadata; state.scanned++
    }).finally(() => {
      if (!controller.signal.aborted) { state.scanning = false; persist() }
    })
  }, { immediate: true })

  watch(() => [state.plan, state.view, state.includeOptional, state.mastery, state.questions, state.today], () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persist, 200)
  }, { deep: true })
  watch(() => [course.value?.id, todayDate.value, state.plan?.createdAt, state.plan?.dailyMinutes, state.includeOptional,
    state.plan?.lessons.map(l => [l.path, l.status]), Object.values(state.mastery).map(m => [m.path, m.concept, m.level]),
    state.questions.map(q => [q.id, q.status]), state.scanning], () => refreshToday(), { deep: true })
  const checkDay = () => { todayDate.value = localDayKey() }
  onMounted(() => {
    window.addEventListener('beforeunload', persist)
    window.addEventListener('focus', checkDay)
    dayTimer = setInterval(checkDay, 30_000)
  })
  onBeforeUnmount(() => { persist(); cancel(); scanner?.abort(); clearInterval(dayTimer); window.removeEventListener('beforeunload', persist); window.removeEventListener('focus', checkDay) })

  const guide = { state, lessonMap, route, routePaths, videoMap, durations, schedule, risks, firstLesson, counts, configured,
    saveSettings, generate, cancel, previewStatus, setStatus, setDailyMinutes, repairDependencies, adjacent, findFallback, exportPlan,
    masteredPaths, unresolvedQuestions, activeQuestion, setMastery, setPracticeMastery, saveQuestion, selectQuestion, markQuestionReview, setQuestionStatus, refreshToday, completeTodayItem }
  provide(GUIDE_KEY, guide)
  return guide
}

export function useGuide() {
  const guide = inject<ReturnType<typeof useLearningGuide>>(GUIDE_KEY)
  if (!guide) throw new Error('Learning guide provider is missing')
  return guide
}

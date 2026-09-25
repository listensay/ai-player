import { onBeforeUnmount, onMounted, computed, reactive, ref, watch, inject, provide } from 'vue'
import type { Ref } from 'vue'
import { useAiSettings } from '~/composables/useAiSettings'
import { useProgress } from '~/composables/useProgress'
import { desktopInvoke } from '~/utils/platform'
import type { Course, VideoEntry } from '~/types/course'
import type { ConceptMastery, FallbackRecommendation, LearningPlan, LearningQuestion, LessonMetadata, LessonStatus, MasteryLevel, QuestionStatus, StudyProgram, StudyRecords, SubtitleCue, TodayPlan, WorkEntry } from '~/types/guide'
import { adjacentRoutePath, buildSchedule, dependencyRisks, isRecord, orderedRoute, retainPrerequisites, validateLearningPlan } from '~/utils/guide'
import { planPrompt, practicePrompt, requestGuideJson } from '~/utils/guideAi'
import { collectGuideMetadata, loadLessonSubtitles, relevantCues } from '~/utils/guideMedia'
import { applyMastery, buildTodayPlan, lessonConcepts, lessonMastery, localDayKey, masteryKey, restoreFeedback } from '~/utils/learningFeedback'
import {
  applyPractice, arrangeWork, budgetForDay, budgetTotal, checkKey, compareRoutes, conciseLessonTitle, emptyStudyRecords, inheritProgram, isLightDay,
  parsePracticeImport, parseProgram, programDay, restoreStudyRecords, stageForDay, stageProgress, videoFinishDay,
} from '~/utils/studyProgram'
import { dbFetchGuide, dbSaveGuide, dbSaveSetting } from '~/utils/dbClient'
import { databaseRequest } from '~/utils/database'

const GUIDE_KEY = Symbol('learning-guide')
const recordsKey = (courseId: string) => `study-records:${courseId}`
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export function useLearningGuide(course: Ref<Course | null>) {
  const progress = useProgress()
  const ai = useAiSettings()
  const state = reactive({
    plan: null as LearningPlan | null,
    metadata: {} as Record<string, LessonMetadata>,
    view: 'all' as 'all' | 'route',
    includeOptional: false,
    busy: '' as '' | 'plan' | 'fallback' | 'practice',
    error: '', storageError: '', notice: '',
    scanning: false, scanned: 0,
    recommendations: [] as FallbackRecommendation[],
    fallbackMessage: '', fallbackQuestion: '', fallbackSource: '',
    mastery: {} as Record<string, ConceptMastery>,
    questions: [] as LearningQuestion[],
    activeQuestionId: '',
    today: null as TodayPlan | null,
    /** 实践记录、验收证据与路线撤销快照，单独存放，不随 AI 重新规划而丢失。 */
    records: emptyStudyRecords() as StudyRecords,
    /** 待确认的路线调整：先预览变化，确认后才替换当前路线。 */
    pending: null as null | { plan: LearningPlan; label: string; notice: string },
    settings: ai.settings,
  })
  let activeId = ''
  let activePaths: string[] = []
  let request: AbortController | null = null
  let scanner: AbortController | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let recordsTimer: ReturnType<typeof setTimeout> | null = null
  const recordsReady = ref(false)
  const todayDate = ref(localDayKey())
  let dayTimer: ReturnType<typeof setInterval> | undefined

  function persist() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    persistRecords()
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

  function persistRecords() {
    if (recordsTimer) clearTimeout(recordsTimer)
    recordsTimer = null
    // 读取失败时不写入，避免空记录覆盖已保存的实践与验收数据。
    if (!activeId || !recordsReady.value) return
    void dbSaveSetting(recordsKey(activeId), plain(state.records))
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
  const routeView = computed(() => state.view === 'route' && !!state.plan)
  const routePositions = computed(() => new Map(route.value.map((lesson, i) => [lesson.path, i + 1])))
  const routeVideos = computed(() => route.value.map(l => videoMap.value.get(l.path)).filter((v): v is VideoEntry => !!v))
  // 编辑列表保留全部课节，但先展示当前路线，顺序与播放、排期和今日安排一致。
  const arrangedLessons = computed(() => [
    ...route.value,
    ...(state.plan?.lessons ?? []).filter(l => !routePositions.value.has(l.path)),
  ])
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
  const configured = ai.configured

  // —— 完整学习计划：总周期、每日时间分配、当前阶段与实践安排 ——
  const program = computed(() => state.plan?.program ?? null)
  const moduleMap = computed(() => new Map(state.plan?.modules.map(m => [m.id, m]) ?? []))
  const planDay = computed(() => program.value ? programDay(program.value, todayDate.value) : null)
  const practiceModules = computed(() => state.plan?.modules.filter(m => m.practice) ?? [])
  /** 按日期应处于的阶段。 */
  const scheduledModule = computed(() => planDay.value && state.plan ? stageForDay(state.plan.modules, planDay.value) : undefined)
  /** 按视频进度所处的阶段（下一节待学课所在板块）。 */
  const progressModule = computed(() => firstLesson.value ? moduleMap.value.get(firstLesson.value.moduleId) : undefined)
  const activeModule = computed(() => moduleMap.value.get(state.records.activeModuleId)
    ?? scheduledModule.value ?? progressModule.value ?? practiceModules.value[0] ?? state.plan?.modules[0])
  const lightDay = computed(() => !!program.value && planDay.value !== null && planDay.value <= program.value.days && isLightDay(program.value, planDay.value))
  const todayBudget = computed(() => program.value && planDay.value !== null ? budgetForDay(program.value, activeModule.value?.practice, planDay.value) : null)
  const todayTotalMinutes = computed(() => todayBudget.value ? budgetTotal(todayBudget.value) : null)
  const todayWork = computed(() => state.records.entries.filter(e => e.date === todayDate.value))
  const workSecondsByDate = computed(() => {
    const result: Record<string, number> = {}
    for (const e of state.records.entries) if (e.minutes > 0) result[e.date] = (result[e.date] ?? 0) + e.minutes * 60
    return result
  })
  const courseProgressMap = computed(() => course.value ? progress.courseProgress(course.value.id) : {})
  const stageProgressMap = computed(() => new Map((state.plan?.modules ?? []).map(m => [m.id, stageProgress(m, route.value, courseProgressMap.value, state.records)])))
  /** 按各阶段看课额度推算视频看完的计划日。 */
  const videoFinish = computed(() => program.value && state.plan
    ? videoFinishDay(program.value, state.plan.modules, todayDate.value, schedule.value.remainingSeconds) : null)

  const pendingPreview = computed(() => {
    const pending = state.pending
    if (!pending || !state.plan) return null
    const before = route.value
    const after = orderedRoute(pending.plan.lessons, false)
    const diff = compareRoutes(before, after)
    const beforeSchedule = schedule.value
    const afterSchedule = buildSchedule(after, durations.value, courseProgressMap.value, pending.plan.dailyMinutes)
    const finish = (plan: LearningPlan, seconds: number) => plan.program ? videoFinishDay(plan.program, plan.modules, todayDate.value, seconds) : null
    return { ...diff, before: beforeSchedule, after: afterSchedule, countBefore: before.length, countAfter: after.length,
      finishBefore: finish(state.plan, beforeSchedule.remainingSeconds), finishAfter: finish(pending.plan, afterSchedule.remainingSeconds),
      programBefore: state.plan.program ?? null, programAfter: pending.plan.program ?? null,
      practiceBefore: state.plan.modules.filter(m => m.practice).length, practiceAfter: pending.plan.modules.filter(m => m.practice).length }
  })

  /** 把存储或文件中的路线恢复为可用计划：校验课节，并保留对话和创建时间。 */
  function restorePlan(raw: unknown, allowEmptyRoute = true) {
    const plan = validateLearningPlan(raw, activePaths, allowEmptyRoute)
    if (isRecord(raw) && Array.isArray(raw.messages)) {
      plan.messages = raw.messages.filter(m => isRecord(m) && ['user', 'assistant'].includes(String(m.role)) && typeof m.content === 'string').slice(-20) as LearningPlan['messages']
      if (typeof raw.createdAt === 'number') plan.createdAt = raw.createdAt
    }
    return plan
  }

  function snapshot(label: string) {
    if (!state.plan) return
    state.records.undo = { plan: plain(state.plan), includeOptional: state.includeOptional, view: state.view, label, at: Date.now() }
  }

  function undo() {
    const revision = state.records.undo
    if (!revision || !course.value || state.busy) return false
    let plan: LearningPlan
    try { plan = restorePlan(revision.plan) } catch {
      state.records.undo = null
      state.error = '撤销记录与当前课程目录不一致，无法恢复。'
      return false
    }
    state.plan = plan; state.view = revision.view; state.includeOptional = revision.includeOptional
    state.records.undo = null; state.pending = null
    state.notice = `已撤销“${revision.label}”。`
    persist()
    return true
  }

  function applyPending() {
    const pending = state.pending
    if (!pending || state.busy) return
    snapshot(pending.label)
    state.plan = pending.plan
    state.view = 'route'; state.includeOptional = false
    state.pending = null
    state.recommendations = []; state.fallbackMessage = ''
    state.notice = pending.notice
    persist()
  }

  function discardPending() {
    if (!state.pending) return
    state.pending = null
    state.notice = '已放弃调整。'
  }

  function setActiveModule(id: string) {
    if (id && !moduleMap.value.has(id)) return
    state.records.activeModuleId = id
    refreshWork()
  }

  function refreshWork() {
    const current = program.value
    if (!state.plan || !current || !recordsReady.value || planDay.value === null || planDay.value < 1 || !todayBudget.value) return
    const module = activeModule.value
    const light = lightDay.value ? {
      title: current.lightTask?.title ?? '轻量复盘日',
      instructions: current.lightTask?.instructions ?? '回顾本周内容，检查验收进度，整理疑问并安排下周任务；今日不学习新课。',
      minutes: current.lightMinutes,
    } : undefined
    const entries = arrangeWork({ date: todayDate.value, moduleId: module?.id ?? '', stage: module?.practice, budget: todayBudget.value, light }, state.records)
    if (JSON.stringify(entries) === JSON.stringify(todayWork.value)) return
    state.records.entries = [...state.records.entries.filter(e => e.date !== todayDate.value), ...entries]
  }

  function updateWork(id: string, patch: Partial<Pick<WorkEntry, 'minutes' | 'evidence' | 'done'>>) {
    const entry = state.records.entries.find(e => e.id === id)
    if (!entry) return false
    if (patch.minutes !== undefined) {
      if (!Number.isInteger(patch.minutes) || patch.minutes < 0 || patch.minutes > 1440) { state.error = '投入时间应为 0–1440 的整数分钟。'; return false }
      entry.minutes = patch.minutes
    }
    if (patch.evidence !== undefined) entry.evidence = patch.evidence.slice(0, 6000)
    if (patch.done !== undefined) entry.done = patch.done
    state.error = ''
    refreshWork()
    return true
  }

  function setCheck(moduleId: string, checkId: string, evidence: string, passed: boolean) {
    const check = moduleMap.value.get(moduleId)?.practice?.checks.find(c => c.id === checkId)
    if (!check) return false
    const value = evidence.trim().slice(0, 6000)
    if (passed && !value) { state.error = '请先填写验收证据，例如仓库链接、测试结果或演示说明。'; return false }
    state.records.checks[checkKey(moduleId, checkId)] = { text: check.text, evidence: value, passed, updatedAt: Date.now() }
    state.error = ''
    return true
  }

  /** 保存完整学习计划；看课额度同步为播放器排期使用的每日时间。 */
  function setProgram(value: StudyProgram) {
    if (!state.plan || state.busy) return false
    let next: StudyProgram
    try { next = parseProgram(plain(value)) } catch (err) { state.error = (err as Error).message; return false }
    const overflow = state.plan.modules.find(m => m.practice && m.practice.endDay > next.days)
    if (overflow) { state.error = `阶段“${overflow.title}”安排到第 ${overflow.practice!.endDay} 天，总天数不能少于该值。`; return false }
    state.plan.program = next
    if (next.budget.video >= 5) state.plan.dailyMinutes = next.budget.video
    state.error = ''
    state.notice = '完整学习计划已保存。'
    refreshWork()
    return true
  }

  function defaultProgram(): StudyProgram {
    const video = state.plan?.dailyMinutes ?? 60
    return { days: Math.min(1095, Math.max(7, schedule.value.days || 30)), startDate: todayDate.value,
      budget: { video, code: 0, project: 0, recap: 0 }, lightEvery: 0, lightMinutes: 60 }
  }

  async function generatePractice() {
    const current = course.value
    if (!current || !state.plan || state.busy) return false
    if (!configured.value) { state.error = '请先选择有效的 AI 配置。'; return false }
    const controller = new AbortController()
    request = controller; state.busy = 'practice'; state.error = ''; state.notice = ''
    try {
      const raw = await requestGuideJson({ ...state.settings }, practicePrompt(state.plan, route.value, todayDate.value), controller.signal)
      if (controller.signal.aborted || current.id !== activeId || !state.plan) return false
      const practice = parsePracticeImport(raw, state.plan.modules, state.plan.program)
      snapshot('AI 补全实践安排')
      applyPractice(state.plan, practice)
      state.notice = `已为 ${Object.keys(practice.stages).length} 个阶段补充实践任务与验收清单，可在知识地图中查看。`
      refreshWork(); persist()
      return true
    } catch (err) {
      if (!controller.signal.aborted) state.error = (err as Error).message
      return false
    } finally {
      if (request === controller) { request = null; state.busy = '' }
    }
  }

  /** 导入导出的学习路线（先预览再应用），或只包含 program / stages 的实践安排。 */
  function importFile(content: string) {
    if (!course.value || state.busy) return false
    let raw: unknown
    try { raw = JSON.parse(content) } catch { state.error = '文件不是有效的 JSON。'; return false }
    try {
      if (isRecord(raw) && isRecord(raw.plan)) {
        const plan = restorePlan(raw.plan, false)
        if (!state.plan) {
          state.plan = plan; state.view = 'route'; state.includeOptional = false
          state.notice = '学习路线已导入。'
          persist()
        } else {
          inheritProgram(plan, state.plan)
          state.pending = { plan, label: '导入学习路线', notice: '已导入学习路线。' }
          state.notice = ''
        }
      } else {
        if (!state.plan) throw new Error('请先生成或导入学习路线，再导入实践安排。')
        const practice = parsePracticeImport(raw, state.plan.modules, state.plan.program)
        snapshot('导入实践安排')
        applyPractice(state.plan, practice)
        state.notice = `已导入${practice.program ? '完整学习计划和' : ''} ${Object.keys(practice.stages).length} 个阶段的实践安排。`
        refreshWork(); persist()
      }
      state.error = ''
      return true
    } catch (err) {
      state.error = (err as Error).message
      return false
    }
  }

  async function generate(text: string, dailyMinutes: number) {
    const current = course.value
    if (!current || state.busy) return false
    if (!configured.value) { state.error = '请先选择有效的 AI 配置。'; return false }
    if (!text.trim()) { state.error = '请填写已有基础与学习目标。'; return false }
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
      })), text.trim(), dailyMinutes, previous, { mastery: Object.values(state.mastery), questions: state.questions.map(q => ({ path: q.path, text: q.text, status: q.status })) }, todayDate.value), controller.signal)
      if (controller.signal.aborted || current.id !== activeId) return false
      const plan = inheritProgram(validateLearningPlan(raw, current.videos.map(v => v.path)), previous)
      const promoted = retainPrerequisites(plan.lessons, false, masteredPaths.value)
      applyMastery(plan.lessons, state.mastery)
      plan.messages = [...(previous?.messages ?? []).slice(-18), { role: 'user', content: text.trim() }, { role: 'assistant', content: plan.summary }]
      const notice = promoted.length ? `已保留 ${promoted.length} 节必要的前置课。` : '学习路线已生成，可根据掌握程度调整课节。'
      if (previous) {
        // 已有路线时先预览变化，由用户确认后再替换。
        state.pending = { plan, label: 'AI 调整路线', notice: `路线已更新。${promoted.length ? notice : ''}` }
        state.notice = ''
        return true
      }
      state.plan = plan
      state.view = 'route'
      state.includeOptional = false
      state.recommendations = []; state.fallbackMessage = ''
      state.notice = notice
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
    if (lesson.status === status) return
    snapshot(`调整“${conciseLessonTitle(videoMap.value.get(path)?.title ?? path).slice(0, 40)}”的学习状态`)
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
    // 完整计划中的看课额度与播放器排期保持一致。
    const current = state.plan.program
    if (current && budgetTotal({ ...current.budget, video: minutes }) <= 1440) current.budget = { ...current.budget, video: minutes }
    state.error = ''
    return true
  }

  function repairDependencies() {
    if (!state.plan || state.busy) return
    snapshot('补齐前置课')
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
    state.notice = '已根据掌握程度更新学习路线，观看记录不受影响。'
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
    state.fallbackMessage = question.recommendations.length ? '此前推荐的基础课' : ''
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
      state.notice = question.reviewedPaths.length ? '相关基础课已加入补学路线。' : '疑问已保留，可补充描述。'
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
    // 设置了完整计划时，今日看课时间取当日阶段的看课额度（复盘日为 0）。
    const minutes = selected ?? todayBudget.value?.video ?? state.plan?.dailyMinutes ?? 30
    if (!Number.isInteger(minutes) || minutes < (selected === null ? 0 : 5) || minutes > 1440) { state.error = '今日时间应为 5–1440 的整数分钟。'; return }
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
    if (!configured.value) { state.error = '请先选择有效的 AI 配置。'; return }
    if (!state.plan) { state.error = '请先生成学习路线，再查找基础课。'; return }
    if (!question.trim()) { state.error = '请描述需要理解的知识点，或在笔记中选中疑问内容。'; return }
    if (question.length > 3000) { state.error = '请将疑问精简到 3000 字以内。'; return }
    const entry = saveQuestion(question, currentVideo.path, seconds, questionId)
    if (!entry) return
    state.activeQuestionId = entry.id
    const candidates = state.plan.lessons.filter(l => (l.status === 'skipped' || entry.reviewedPaths.includes(l.path)) && (videoMap.value.get(l.path)?.index ?? Infinity) < currentVideo.index)
    state.error = ''; state.recommendations = []; state.fallbackMessage = ''
    state.fallbackQuestion = question.trim(); state.fallbackSource = currentVideo.path
    if (!candidates.length) { entry.recommendations = []; state.fallbackMessage = '此前无已跳过的基础课，可查看完整目录或调整学习目标。'; return }
    const controller = new AbortController()
    request = controller; state.busy = 'fallback'
    const requestSettings = { ...state.settings }
    try {
      const raw = await requestGuideJson(requestSettings, [{ role: 'user', content: `根据疑问，从此前跳过的课节中推荐最多 3 节需要回看的基础课。只选直接相关的课节，没有匹配则返回空数组。keywords 为用于在字幕中检索的 2–5 个具体关键词。不要返回时间点。
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
          const segments = await requestGuideJson(requestSettings, [{ role: 'user', content: `为疑问选择每节课最相关的一条字幕作为回看起点。只能引用提供的 cueId；不相关的返回 null。不要自行生成时间戳。
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
          segmentWarning = '已找到基础课，暂无法定位字幕，可从头观看。'
        }
      }
      if (controller.signal.aborted || current.id !== activeId) return
      state.recommendations = result
      entry.recommendations = result
      state.fallbackMessage = segmentWarning || (result.length ? '已找到基础课，回看后可返回提问位置。' : '已跳过的课节中无匹配结果，请补充术语或疑问描述。')
    } catch (err) {
      if (!controller.signal.aborted) state.error = (err as Error).message
    } finally { if (request === controller) { request = null; state.busy = '' } }
  }

  async function exportPlan() {
    if (!state.plan || !course.value) return
    const content = JSON.stringify({ course: course.value.name, plan: state.plan, mastery: state.mastery, questions: state.questions, today: state.today,
      records: { entries: state.records.entries, checks: state.records.checks } }, null, 2)
    try { await desktopInvoke('export_learning_plan', { name: `${course.value.name}-学习路线.json`, content }) }
    catch { state.error = '学习路线导出失败，请重试。' }
  }

  watch(() => course.value?.id, async (_id, _oldId, onCleanup) => {
    let stale = false
    onCleanup(() => { stale = true })
    persist(); cancel(); scanner?.abort()
    const current = course.value
    activeId = current?.id ?? ''; activePaths = current?.videos.map(v => v.path) ?? []
    recordsReady.value = false
    Object.assign(state, { plan: null, metadata: {}, view: 'all', includeOptional: false, scanned: 0, scanning: false,
      error: '', storageError: '', notice: '', recommendations: [], fallbackMessage: '', fallbackQuestion: '', fallbackSource: '',
      mastery: {}, questions: [], today: null, activeQuestionId: '', records: emptyStudyRecords(), pending: null })
    if (!current) return
    const records = databaseRequest<unknown>('settings', { query: { key: recordsKey(current.id) } })
      .then(value => ({ ok: true as const, value }), () => ({ ok: false as const, value: null }))
    try {
      let stored = await dbFetchGuide(current.id) as any
      if (stale) return
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
          state.plan = restorePlan(stored.plan); state.view = stored.view === 'route' ? 'route' : 'all'; state.includeOptional = stored.includeOptional === true
        }
      }
    } catch { state.notice = '学习路线读取失败，可重新生成。观看进度已保留。' }
    const loaded = await records
    if (stale) return
    if (loaded.ok) {
      state.records = restoreStudyRecords(loaded.value)
      recordsReady.value = true
    } else {
      state.storageError = '实践记录读取失败，本次修改不会保存，以免覆盖原有记录。请重新打开课程。'
    }
    if (stale) return
    refreshWork(); refreshToday()
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
  watch(() => state.records, () => {
    if (recordsTimer) clearTimeout(recordsTimer)
    recordsTimer = setTimeout(persistRecords, 300)
  }, { deep: true })
  watch(() => [course.value?.id, todayDate.value, state.plan?.createdAt, state.plan?.dailyMinutes, state.includeOptional, todayBudget.value?.video,
    state.plan?.lessons.map(l => [l.path, l.status]), Object.values(state.mastery).map(m => [m.path, m.concept, m.level]),
    state.questions.map(q => [q.id, q.status]), state.scanning], () => refreshToday(), { deep: true })
  watch(() => [todayDate.value, activeModule.value?.id, JSON.stringify(program.value), JSON.stringify(activeModule.value?.practice ?? null), recordsReady.value],
    () => refreshWork())
  const checkDay = () => { todayDate.value = localDayKey() }
  onMounted(() => {
    window.addEventListener('beforeunload', persist)
    window.addEventListener('focus', checkDay)
    dayTimer = setInterval(checkDay, 30_000)
  })
  onBeforeUnmount(() => { persist(); cancel(); scanner?.abort(); clearInterval(dayTimer); window.removeEventListener('beforeunload', persist); window.removeEventListener('focus', checkDay) })

  const guide = { persist, state, ai, lessonMap, route, routePaths, routeView, routePositions, routeVideos, arrangedLessons, videoMap, durations, schedule, risks, firstLesson, counts, configured,
    generate, cancel, previewStatus, setStatus, setDailyMinutes, repairDependencies, adjacent, findFallback, exportPlan,
    masteredPaths, unresolvedQuestions, activeQuestion, setMastery, setPracticeMastery, saveQuestion, selectQuestion, markQuestionReview, setQuestionStatus, refreshToday, completeTodayItem,
    todayDate, program, moduleMap, planDay, practiceModules, scheduledModule, progressModule, activeModule, lightDay, todayBudget, todayTotalMinutes, todayWork,
    workSecondsByDate, courseProgressMap, stageProgressMap, videoFinish, pendingPreview, recordsReady,
    undo, applyPending, discardPending, setActiveModule, refreshWork, updateWork, setCheck, setProgram, defaultProgram, generatePractice, importFile }
  provide(GUIDE_KEY, guide)
  return guide
}

export function useGuide() {
  const guide = inject<ReturnType<typeof useLearningGuide>>(GUIDE_KEY)
  if (!guide) throw new Error('Learning guide provider is missing')
  return guide
}

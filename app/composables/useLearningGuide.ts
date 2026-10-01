import { useGuideScheduling } from '~/composables/useGuideScheduling'
import { useGuideMastery } from '~/composables/useGuideMastery'
import { useGuideAi } from '~/composables/useGuideAi'
import { onBeforeUnmount, onMounted, computed, reactive, ref, watch, inject, provide } from 'vue'
import type { Ref } from 'vue'
import { useAiSettings } from '~/composables/useAiSettings'
import { useProgress } from '~/composables/useProgress'
import { desktopInvoke } from '~/utils/platform'
import type { Course, VideoEntry } from '~/types/course'
import type {
  ConceptMastery,
  LearningPlan,
  LearningQuestion,
  LessonMetadata,
  LessonStatus,
  StudyRecords,
  TodayPlan,
} from '~/types/guide'
import {
  adjacentRoutePath,
  buildSchedule,
  dependencyRisks,
  isRecord,
  orderedRoute,
  retainPrerequisites,
  validateLearningPlan,
} from '~/utils/guide'
import { collectGuideMetadata } from '~/utils/guideMedia'
import { lessonMastery, localDayKey, restoreFeedback } from '~/utils/learningFeedback'
import {
  applyPractice,
  budgetTotal,
  compareRoutes,
  conciseLessonTitle,
  emptyStudyRecords,
  inheritProgram,
  isLightDay,
  parsePracticeImport,
  programDay,
  restoreStudyRecords,
  stageForDay,
  stageProgress,
  videoFinishDay,
} from '~/utils/studyProgram'
import { useGuidePersistence } from '~/composables/useGuidePersistence'
import { progressForPlanning, restoreCompletionHistory } from '~/utils/learningHistory'
import { dbFetchGuide } from '~/utils/dbClient'
import { databaseRequest } from '~/utils/database'
import { calculateDayBudget, daySnapshot } from '~/utils/dailyPlan'

const GUIDE_KEY = Symbol.for('ai-player.learning-guide')
const recordsKey = (courseId: string) => `study-records:${courseId}`

export function useLearningGuide(course: Ref<Course | null>, schedulingEnabled: Ref<boolean> = ref(true)) {
  const progress = useProgress()
  const ai = useAiSettings()
  const state = reactive({
    plan: null as LearningPlan | null,
    metadata: {} as Record<string, LessonMetadata>,
    view: 'all' as 'all' | 'route',
    includeOptional: false,
    busy: '' as '' | 'plan' | 'practice',
    error: '',
    storageError: '',
    notice: '',
    scanning: false,
    scanned: 0,
    mastery: {} as Record<string, ConceptMastery>,
    /** 仅保留旧版疑问记录用于存储兼容，不再参与 AI 或今日排期。 */
    questions: [] as LearningQuestion[],
    today: null as TodayPlan | null,
    /** 实践记录、验收证据与路线撤销快照，单独存放，不随 AI 重新规划而丢失。 */
    records: emptyStudyRecords() as StudyRecords,
    /** 待确认的路线调整：先预览变化，确认后才替换当前路线。 */
    pending: null as null | { plan: LearningPlan; label: string; notice: string },
    settings: ai.settings,
  })
  let activeId = ''
  let activePaths: string[] = []
  let scanner: AbortController | null = null
  const recordsReady = ref(false)
  const guideReady = ref(false)
  let loadRevision = 0
  const todayDate = ref(localDayKey())
  let dayTimer: ReturnType<typeof setInterval> | undefined

  const persistence = useGuidePersistence({
    revision: () => loadRevision,
    guide: () =>
      !activeId || !guideReady.value
        ? null
        : {
            courseId: activeId,
            plan: state.plan,
            metadata: state.metadata,
            view: state.view,
            includeOptional: state.includeOptional,
            mastery: state.mastery,
            questions: state.questions,
            today: state.today,
          },
    records: () => (!activeId || !recordsReady.value ? null : { key: recordsKey(activeId), value: state.records }),
    day: () =>
      !activeId || course.value?.id !== activeId || !guideReady.value || !recordsReady.value || !state.plan
        ? null
        : { courseId: activeId, snapshot: todaySnapshot.value },
    error: (message) => {
      state.storageError = message
    },
  })
  const { persist } = persistence

  const lessonMap = computed(() => new Map(state.plan?.lessons.map((l) => [l.path, l]) ?? []))
  const masteredPaths = computed(
    () =>
      new Set(
        (state.plan?.lessons ?? []).filter((l) => lessonMastery(l, state.mastery) === 'mastered').map((l) => l.path),
      ),
  )
  const route = computed(() => orderedRoute(state.plan?.lessons ?? [], state.includeOptional))
  const routePaths = computed(() => route.value.map((l) => l.path))
  const videoMap = computed(() => new Map(course.value?.videos.map((v) => [v.path, v]) ?? []))
  const routeView = computed(() => state.view === 'route' && !!state.plan)
  const routePositions = computed(() => new Map(route.value.map((lesson, i) => [lesson.path, i + 1])))
  const routeVideos = computed(() =>
    route.value.map((l) => videoMap.value.get(l.path)).filter((v): v is VideoEntry => !!v),
  )
  // 编辑列表保留全部课节，但先展示当前路线，顺序与播放、排期和今日安排一致。
  const arrangedLessons = computed(() => [
    ...route.value,
    ...(state.plan?.lessons ?? []).filter((l) => !routePositions.value.has(l.path)),
  ])
  const durations = computed(() =>
    Object.fromEntries(
      (course.value?.videos ?? []).map((v) => [
        v.path,
        progress.get(course.value!.id, v.path)?.duration || state.metadata[v.path]?.duration || null,
      ]),
    ),
  )
  const schedule = computed(() =>
    buildSchedule(route.value, durations.value, courseProgressMap.value, state.plan?.dailyMinutes ?? 120),
  )
  const risks = computed(() => dependencyRisks(state.plan?.lessons ?? [], state.includeOptional, masteredPaths.value))
  const firstLesson = computed(() => route.value.find((l) => !courseProgressMap.value[l.path]?.done) ?? route.value[0])
  const counts = computed(() => {
    const lessons = state.plan?.lessons ?? []
    return {
      required: lessons.filter((l) => l.status === 'required').length,
      optional: lessons.filter((l) => l.status === 'optional').length,
      skipped: lessons.filter((l) => l.status === 'skipped').length,
    }
  })
  const configured = ai.configured

  // —— 完整学习计划：总周期、每日时间分配、当前阶段与实践安排 ——
  const program = computed(() => state.plan?.program ?? null)
  const moduleMap = computed(() => new Map(state.plan?.modules.map((m) => [m.id, m]) ?? []))
  const planDay = computed(() => (program.value ? programDay(program.value, todayDate.value) : null))
  const practiceModules = computed(() => state.plan?.modules.filter((m) => m.practice) ?? [])
  /** 按日期应处于的阶段。 */
  const scheduledModule = computed(() =>
    planDay.value && state.plan ? stageForDay(state.plan.modules, planDay.value) : undefined,
  )
  /** 按视频进度所处的阶段（下一节待学课所在板块）。 */
  const progressModule = computed(() =>
    firstLesson.value ? moduleMap.value.get(firstLesson.value.moduleId) : undefined,
  )
  const activeModule = computed(
    () =>
      moduleMap.value.get(state.records.activeModuleId) ??
      scheduledModule.value ??
      progressModule.value ??
      practiceModules.value[0] ??
      state.plan?.modules[0],
  )
  const lightDay = computed(
    () =>
      !!program.value &&
      planDay.value !== null &&
      planDay.value <= program.value.days &&
      isLightDay(program.value, planDay.value),
  )
  const dayContext = computed(() => ({
    plan: state.plan,
    includeOptional: state.includeOptional,
    metadata: state.metadata,
    progress: course.value ? progress.courseProgress(course.value.id) : {},
    mastery: state.mastery,
    questions: state.questions,
    records: state.records,
    today: state.today,
    enabled: schedulingEnabled.value,
  }))
  const todayBudget = computed(() => (program.value ? calculateDayBudget(dayContext.value, todayDate.value) : null))
  const todaySnapshot = computed(() => daySnapshot(dayContext.value, todayDate.value))
  const todayTotalMinutes = computed(() => (todayBudget.value ? budgetTotal(todayBudget.value) : null))
  const todayWork = computed(() => state.records.entries.filter((e) => e.date === todayDate.value))
  const workSecondsByDate = computed(() => {
    const result: Record<string, number> = {}
    for (const e of state.records.entries) if (e.minutes > 0) result[e.date] = (result[e.date] ?? 0) + e.minutes * 60
    return result
  })
  const courseProgressMap = computed(() =>
    progressForPlanning(
      course.value ? progress.courseProgress(course.value.id) : {},
      state.metadata,
      state.today,
      todayDate.value,
    ),
  )
  const stageProgressMap = computed(
    () =>
      new Map(
        (state.plan?.modules ?? []).map((m) => [
          m.id,
          stageProgress(m, route.value, courseProgressMap.value, state.records),
        ]),
      ),
  )
  /** 按各阶段看课额度推算视频看完的计划日。 */
  const videoFinish = computed(() =>
    program.value && state.plan
      ? videoFinishDay(
          program.value,
          state.plan.modules,
          todayDate.value,
          schedule.value.remainingSeconds,
          state.today?.date === todayDate.value
            ? state.today.items.filter((i) => i.done && i.kind !== 'question').reduce((n, i) => n + i.seconds, 0)
            : 0,
        )
      : null,
  )

  const pendingPreview = computed(() => {
    const pending = state.pending
    if (!pending || !state.plan) return null
    const before = route.value
    const after = orderedRoute(pending.plan.lessons, false)
    const diff = compareRoutes(before, after)
    const beforeSchedule = schedule.value
    const afterSchedule = buildSchedule(after, durations.value, courseProgressMap.value, pending.plan.dailyMinutes)
    const finish = (plan: LearningPlan, seconds: number) =>
      plan.program ? videoFinishDay(plan.program, plan.modules, todayDate.value, seconds) : null
    return {
      ...diff,
      before: beforeSchedule,
      after: afterSchedule,
      countBefore: before.length,
      countAfter: after.length,
      finishBefore: finish(state.plan, beforeSchedule.remainingSeconds),
      finishAfter: finish(pending.plan, afterSchedule.remainingSeconds),
      programBefore: state.plan.program ?? null,
      programAfter: pending.plan.program ?? null,
      practiceBefore: state.plan.modules.filter((m) => m.practice).length,
      practiceAfter: pending.plan.modules.filter((m) => m.practice).length,
    }
  })

  /** 把存储或文件中的路线恢复为可用计划：校验课节，并保留对话和创建时间。 */
  function restorePlan(raw: unknown, allowEmptyRoute = true) {
    const plan = validateLearningPlan(raw, activePaths, allowEmptyRoute)
    if (isRecord(raw) && Array.isArray(raw.messages)) {
      plan.messages = raw.messages
        .filter((m) => isRecord(m) && ['user', 'assistant'].includes(String(m.role)) && typeof m.content === 'string')
        .slice(-20) as LearningPlan['messages']
      if (typeof raw.createdAt === 'number') plan.createdAt = raw.createdAt
    }
    return plan
  }

  /** 导入导出的学习路线（先预览再应用），或只包含 program / stages 的实践安排。 */
  function importFile(content: string) {
    if (!guideReady.value) return false
    if (!course.value || state.busy) return false
    let raw: unknown
    try {
      raw = JSON.parse(content)
    } catch {
      state.error = '文件不是有效的 JSON。'
      return false
    }
    try {
      if (isRecord(raw) && isRecord(raw.plan)) {
        const plan = restorePlan(raw.plan, false)
        if (!state.plan) {
          state.plan = plan
          state.view = 'route'
          state.includeOptional = false
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
        refreshWork()
        persist()
      }
      state.error = ''
      return true
    } catch (err) {
      state.error = (err as Error).message
      return false
    }
  }

  function previewStatus(path: string, status: LessonStatus) {
    const lessons = state.plan?.lessons.map((l) => ({ ...l, status: l.path === path ? status : l.status })) ?? []
    return dependencyRisks(lessons, state.includeOptional, masteredPaths.value)
  }

  function setStatus(path: string, status: LessonStatus) {
    if (!state.plan || state.busy) return
    const lesson = lessonMap.value.get(path)
    if (!lesson) return
    if (lesson.status === 'required' && status !== 'required' && counts.value.required === 1) {
      state.error = '路线至少需要保留一节必修课。'
      return
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
    if (current && budgetTotal({ ...current.budget, video: minutes }) <= 1440)
      current.budget = { ...current.budget, video: minutes }
    state.error = ''
    return true
  }

  function repairDependencies() {
    if (!state.plan || state.busy) return
    snapshot('补齐前置课')
    const lessons = state.plan.lessons.map((l) => ({ ...l }))
    const promoted = retainPrerequisites(lessons, state.includeOptional, masteredPaths.value)
    state.plan.lessons = lessons
    state.notice = `已将 ${promoted.length} 节前置课加入必修路线。`
  }

  function adjacent(currentPath: string, offset: -1 | 1): VideoEntry | undefined {
    const catalog = course.value?.videos.map((v) => v.path) ?? []
    const paths = state.view === 'route' && state.plan ? routePaths.value : catalog
    const path = adjacentRoutePath(paths, currentPath, offset, catalog)
    return path ? videoMap.value.get(path) : undefined
  }

  async function exportPlan() {
    if (!state.plan || !course.value) return
    const content = JSON.stringify(
      {
        course: course.value.name,
        plan: state.plan,
        mastery: state.mastery,
        questions: state.questions,
        today: state.today,
        records: { entries: state.records.entries, checks: state.records.checks },
      },
      null,
      2,
    )
    try {
      await desktopInvoke('export_learning_plan', { name: `${course.value.name}-学习路线.json`, content })
    } catch {
      state.error = '学习路线导出失败，请重试。'
    }
  }

  const {
    snapshot,
    undo,
    applySchedule,
    applyPending,
    discardPending,
    setActiveModule,
    refreshWork,
    updateWork,
    setCheck,
    setProgram,
    defaultProgram,
    planForScheduling,
    refreshToday,
    completeTodayItem,
    nextStudy,
    continueNextDay,
  } = useGuideScheduling(state, {
    course,
    guideReady,
    recordsReady,
    todayDate,
    moduleMap,
    program,
    planDay,
    todayBudget,
    todayWork,
    dayContext,
    schedule,
    restorePlan,
    persist,
  })
  const { setMastery, setPracticeMastery } = useGuideMastery(state, { lessonMap, videoMap, persist })
  const { generate, generatePractice, cancel } = useGuideAi(state, {
    course,
    activeId: () => activeId,
    guideReady,
    configured,
    progress,
    durations,
    route,
    todayDate,
    masteredPaths,
    snapshot,
    refreshWork,
    persist,
  })

  watch(
    () => course.value?.id,
    async (_id, _oldId, onCleanup) => {
      let stale = false
      onCleanup(() => {
        stale = true
      })
      persist()
      cancel()
      scanner?.abort()
      loadRevision++
      guideReady.value = false
      persistence.reset()
      const current = course.value
      activeId = current?.id ?? ''
      activePaths = current?.videos.map((v) => v.path) ?? []
      recordsReady.value = false
      Object.assign(state, {
        plan: null,
        metadata: {},
        view: 'all',
        includeOptional: false,
        scanned: 0,
        scanning: false,
        error: '',
        storageError: '',
        notice: '',
        mastery: {},
        questions: [],
        today: null,
        records: emptyStudyRecords(),
        pending: null,
      })
      if (!current) return
      const records = databaseRequest<unknown>('settings', { query: { key: recordsKey(current.id) } }).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const, value: null }),
      )
      try {
        const [stored, snapshots, practiceScopes] = await Promise.all([
          dbFetchGuide(current.id),
          databaseRequest('day-snapshots', { query: { courseId: current.id } }),
          databaseRequest('practice-scopes', { query: { courseId: current.id } }),
        ])
        if (stale) return
        if (isRecord(stored)) {
          Object.assign(state, restoreFeedback(stored, activePaths))
          if (isRecord(stored.metadata)) {
            for (const path of activePaths) {
              const entry = stored.metadata[path]
              if (
                isRecord(entry) &&
                typeof entry.size === 'number' &&
                typeof entry.modified === 'number' &&
                (entry.duration === null ||
                  (typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration > 0))
              ) {
                state.metadata[path] = { size: entry.size, modified: entry.modified, duration: entry.duration }
              }
            }
          }
          if (stored.plan) {
            state.plan = restorePlan(stored.plan)
            state.view = stored.view === 'route' ? 'route' : 'all'
            state.includeOptional = stored.includeOptional === true
          }
        }
        todayDate.value = localDayKey()
        state.today = restoreCompletionHistory(state.today, todayDate.value, activePaths, snapshots, practiceScopes)
        guideReady.value = true
      } catch {
        if (stale) return
        state.storageError = '导学数据读取失败，已暂停保存并保留原有记录。请重新打开课程后重试。'
      }
      const loaded = await records
      if (stale) return
      if (loaded.ok) {
        state.records = restoreStudyRecords(loaded.value)
        recordsReady.value = true
      } else {
        state.storageError = '实践记录读取失败，本次修改不会保存，以免覆盖原有记录。请重新打开课程。'
      }
      if (stale) return
      refreshWork()
      refreshToday()
      const controller = new AbortController()
      scanner = controller
      state.scanning = true
      void collectGuideMetadata(current.videos, state.metadata, controller.signal, (path, metadata) => {
        state.metadata[path] = metadata
        state.scanned++
        if (state.scanned % 256 === 0) persist()
      }).finally(() => {
        if (!controller.signal.aborted) {
          state.scanning = false
          persist()
        }
      })
    },
    { immediate: true },
  )

  watch(
    () => [state.plan, state.view, state.includeOptional, state.mastery, state.questions, state.today],
    () => {
      if (!guideReady.value) return
      persistence.schedule()
    },
    { deep: true },
  )
  watch(
    () => state.records,
    () => {
      persistence.scheduleRecords()
    },
    { deep: true },
  )
  watch(
    () => [
      course.value?.id,
      todayDate.value,
      state.plan?.createdAt,
      state.plan?.dailyMinutes,
      state.includeOptional,
      todayBudget.value?.video,
      schedulingEnabled.value,
      state.plan?.lessons.map((l) => [l.path, l.status]),
      Object.values(state.mastery).map((m) => [m.path, m.concept, m.level]),
      state.questions.map((q) => [q.id, q.status]),
      state.scanning,
    ],
    () => refreshToday(),
    { deep: true },
  )
  // 播放进度只在任务完成状态或实际时长变化时重排，不依赖预算计算的附带更新。
  watch(
    () =>
      JSON.stringify(
        state.today?.items
          .filter((item) => item.kind !== 'question' && !item.done)
          .map((item) => {
            const p = course.value ? progress.get(course.value.id, item.path) : undefined
            return [item.id, p?.duration, item.kind === 'lesson' && (!!p?.done || (p?.time ?? 0) >= item.end)]
          }),
      ),
    () => refreshToday(),
  )
  watch(
    () => [
      todayDate.value,
      activeModule.value?.id,
      JSON.stringify(program.value),
      JSON.stringify(activeModule.value?.practice ?? null),
      recordsReady.value,
      schedulingEnabled.value,
    ],
    () => refreshWork(),
  )
  const checkDay = () => {
    const day = localDayKey()
    if (day !== todayDate.value) {
      persist()
      todayDate.value = day
    }
  }
  onMounted(() => {
    window.addEventListener('beforeunload', persist)
    window.addEventListener('focus', checkDay)
    dayTimer = setInterval(checkDay, 30_000)
  })
  onBeforeUnmount(() => {
    persist()
    cancel()
    scanner?.abort()
    clearInterval(dayTimer)
    window.removeEventListener('beforeunload', persist)
    window.removeEventListener('focus', checkDay)
  })

  const guide = {
    persist,
    state,
    ai,
    lessonMap,
    route,
    routePaths,
    routeView,
    routePositions,
    routeVideos,
    arrangedLessons,
    videoMap,
    durations,
    schedule,
    risks,
    firstLesson,
    counts,
    configured,
    generate,
    cancel,
    previewStatus,
    setStatus,
    setDailyMinutes,
    repairDependencies,
    adjacent,
    exportPlan,
    masteredPaths,
    setMastery,
    setPracticeMastery,
    refreshToday,
    completeTodayItem,
    nextStudy,
    continueNextDay,
    todayDate,
    program,
    moduleMap,
    planDay,
    practiceModules,
    scheduledModule,
    progressModule,
    activeModule,
    lightDay,
    todayBudget,
    todayTotalMinutes,
    todayWork,
    workSecondsByDate,
    courseProgressMap,
    stageProgressMap,
    videoFinish,
    pendingPreview,
    recordsReady,
    guideReady,
    undo,
    applyPending,
    discardPending,
    applySchedule,
    planForScheduling,
    dayContext,
    schedulingEnabled,
    setActiveModule,
    refreshWork,
    updateWork,
    setCheck,
    setProgram,
    defaultProgram,
    generatePractice,
    importFile,
  }
  provide(GUIDE_KEY, guide)
  return guide
}

export function useGuide() {
  const guide = inject<ReturnType<typeof useLearningGuide>>(GUIDE_KEY)
  if (!guide) throw new Error('Learning guide provider is missing')
  return guide
}

import { computed, type Ref } from 'vue'
import type { Course } from '~/types/course'
import type { KnowledgeModule, LearningPlan, StudyProgram, WorkEntry } from '~/types/guide'
import type { GuideWorkspaceState } from '~/types/guideWorkspace'
import type { buildSchedule } from '~/utils/guide'
import { budgetTotal, checkKey, parseProgram } from '~/utils/studyProgram'
import { localDayKey } from '~/utils/learningFeedback'
import { calculateDay, calculateDayWork, nextStudyDay } from '~/utils/dailyPlan'
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export function useGuideScheduling(
  state: GuideWorkspaceState,
  options: {
    course: Ref<Course | null>
    guideReady: Ref<boolean>
    recordsReady: Ref<boolean>
    todayDate: Ref<string>
    moduleMap: Ref<Map<string, KnowledgeModule>>
    program: Ref<StudyProgram | null>
    planDay: Ref<number | null>
    todayBudget: Ref<ReturnType<typeof calculateDay>['budget'] | null>
    todayWork: Ref<WorkEntry[]>
    dayContext: Ref<Parameters<typeof calculateDay>[0]>
    schedule: Ref<ReturnType<typeof buildSchedule>>
    restorePlan: (raw: unknown) => LearningPlan
    persist: () => void
  },
) {
  const {
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
  } = options
  function snapshot(label: string) {
    if (!state.plan) return
    state.records.undo = {
      plan: plain(state.plan),
      includeOptional: state.includeOptional,
      view: state.view,
      label,
      at: Date.now(),
      todayOverride: { date: todayDate.value, minutes: state.today?.override ?? null },
    }
  }

  function undo() {
    const revision = state.records.undo
    if (!revision || !course.value || state.busy) return false
    let plan: LearningPlan
    try {
      plan = restorePlan(revision.plan)
    } catch {
      state.records.undo = null
      state.error = '撤销记录与当前课程目录不一致，无法恢复。'
      return false
    }
    if (revision.scheduleOnly && state.plan) {
      state.plan.program = plan.program
      state.plan.dailyMinutes = plan.dailyMinutes
      for (const module of state.plan.modules) {
        const previous = plan.modules.find((m) => m.id === module.id)?.practice
        if (module.practice && previous) {
          module.practice.startDay = previous.startDay
          module.practice.endDay = previous.endDay
        }
      }
    } else {
      state.plan = plan
      state.view = revision.view
      state.includeOptional = revision.includeOptional
    }
    if (state.today && revision.todayOverride?.date === todayDate.value)
      state.today.override = revision.todayOverride.minutes
    state.records.undo = null
    state.pending = null
    state.notice = `已撤销“${revision.label}”。`
    refreshWork()
    refreshToday()
    persist()
    return true
  }

  function applySchedule(plan: LearningPlan, label: string) {
    if (!guideReady.value || !recordsReady.value || state.busy || !plan.program) return false
    try {
      parseProgram(plan.program)
    } catch (error) {
      state.error = (error as Error).message
      return false
    }
    if (!state.plan) {
      state.plan = plain(plan)
      state.view = 'route'
      state.includeOptional = false
      state.notice = '已设置学习计划。'
      refreshWork()
      refreshToday()
      persist()
      return true
    }
    snapshot(label)
    state.records.undo!.scheduleOnly = true
    state.plan.program = plain(plan.program)
    state.plan.dailyMinutes = plan.dailyMinutes
    for (const module of state.plan.modules) {
      const next = plan.modules.find((m) => m.id === module.id)?.practice
      if (module.practice && next) {
        module.practice.startDay = next.startDay
        module.practice.endDay = next.endDay
      }
    }
    if (state.today) state.today.override = null
    state.error = ''
    state.notice = `已${label}，可撤销。`
    refreshWork()
    refreshToday()
    persist()
    return true
  }

  function applyPending() {
    const pending = state.pending
    if (!pending || state.busy) return
    snapshot(pending.label)
    state.plan = pending.plan
    state.view = 'route'
    state.includeOptional = false
    state.pending = null
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
    if (
      !state.plan ||
      !current ||
      !recordsReady.value ||
      planDay.value === null ||
      planDay.value < 1 ||
      !todayBudget.value
    )
      return
    const entries = calculateDayWork(dayContext.value, todayDate.value)
    if (JSON.stringify(entries) === JSON.stringify(todayWork.value)) return
    state.records.entries = [...state.records.entries.filter((e) => e.date !== todayDate.value), ...entries]
  }

  function updateWork(id: string, patch: Partial<Pick<WorkEntry, 'minutes' | 'evidence' | 'done'>>) {
    const entry = state.records.entries.find((e) => e.id === id)
    if (!entry) return false
    if (patch.minutes !== undefined) {
      if (!Number.isInteger(patch.minutes) || patch.minutes < 0 || patch.minutes > 1440) {
        state.error = '投入时间应为 0–1440 的整数分钟。'
        return false
      }
      entry.minutes = patch.minutes
    }
    if (patch.evidence !== undefined) entry.evidence = patch.evidence.slice(0, 6000)
    if (patch.done !== undefined) entry.done = patch.done
    state.error = ''
    refreshWork()
    return true
  }

  function setCheck(moduleId: string, checkId: string, evidence: string, passed: boolean) {
    const check = moduleMap.value.get(moduleId)?.practice?.checks.find((c) => c.id === checkId)
    if (!check) return false
    const value = evidence.trim().slice(0, 6000)
    if (passed && !value) {
      state.error = '请先填写验收证据，例如仓库链接、测试结果或演示说明。'
      return false
    }
    state.records.checks[checkKey(moduleId, checkId)] = {
      text: check.text,
      evidence: value,
      passed,
      updatedAt: Date.now(),
    }
    state.error = ''
    return true
  }

  /** 保存完整学习计划；看课额度同步为播放器排期使用的每日时间。 */
  function setProgram(value: StudyProgram) {
    if (!state.plan || state.busy) return false
    let next: StudyProgram
    try {
      next = parseProgram(plain(value))
    } catch (err) {
      state.error = (err as Error).message
      return false
    }
    const overflow = state.plan.modules.find((m) => m.practice && m.practice.endDay > next.days)
    if (overflow) {
      state.error = `阶段“${overflow.title}”安排到第 ${overflow.practice!.endDay} 天，总天数不能少于该值。`
      return false
    }
    snapshot('编辑学习计划')
    state.records.undo!.scheduleOnly = true
    state.plan.program = next
    if (next.budget.video >= 5) state.plan.dailyMinutes = next.budget.video
    state.error = ''
    state.notice = '完整学习计划已保存。'
    refreshWork()
    return true
  }

  function defaultProgram(): StudyProgram {
    const video = state.plan?.dailyMinutes ?? 60
    return {
      days: Math.min(1095, Math.max(7, schedule.value.days || 30)),
      startDate: todayDate.value,
      budget: { video, code: 0, project: 0, recap: 0 },
      lightEvery: 0,
      lightMinutes: 60,
    }
  }

  function planForScheduling(): LearningPlan {
    if (state.plan) return { ...plain(state.plan), program: plain(state.plan.program ?? defaultProgram()) }
    return {
      version: 1,
      createdAt: Date.now(),
      summary: '按课程顺序学习',
      profile: '按原课程目录安排学习',
      dailyMinutes: 30,
      modules: [{ id: 'course', title: '课程学习', description: '按原课程顺序安排视频学习。' }],
      messages: [],
      lessons: (course.value?.videos ?? []).map((video, index, videos) => ({
        path: video.path,
        moduleId: 'course',
        concepts: [],
        prerequisites: index ? [videos[index - 1]!.path] : [],
        status: 'required',
        reason: '按课程顺序学习',
      })),
      program: { ...defaultProgram(), budget: { video: 30, code: 0, project: 0, recap: 0 } },
    }
  }

  function refreshToday(override: number | null | undefined = undefined) {
    if (!course.value || !guideReady.value) return
    todayDate.value = localDayKey()
    if (
      override !== null &&
      override !== undefined &&
      (!Number.isInteger(override) || override < 0 || override > 1440)
    ) {
      state.error = '今日时间应为 0–1440 的整数分钟。'
      return
    }
    const next = calculateDay(dayContext.value, todayDate.value, override)
    if (budgetTotal(next.budget) > 1440) {
      state.error = '今日总投入不能超过 1440 分钟。'
      return
    }
    if (JSON.stringify(state.today) !== JSON.stringify(next.today)) state.today = next.today
  }

  function completeTodayItem(id: string, done: boolean) {
    const item = state.today?.items.find((i) => i.id === id)
    if (!item) return
    item.done = done
    persist()
  }

  const nextStudy = computed(() =>
    guideReady.value && recordsReady.value && !state.busy ? nextStudyDay(dayContext.value, todayDate.value) : null,
  )

  function continueNextDay() {
    // 午夜后旧页面上的入口不能把前一天的任务加入新的一天。
    if (todayDate.value !== localDayKey()) {
      refreshToday()
      return null
    }
    const next = nextStudy.value
    if (!next) return null
    state.today = next.today
    state.error = ''
    state.notice = `已加入 ${next.date} 的课程，学习用时计入今天。`
    persist()
    return next.next
  }

  return {
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
  }
}

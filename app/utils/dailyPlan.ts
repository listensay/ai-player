import type {
  ConceptMastery,
  GuideLesson,
  KnowledgeModule,
  LearningPlan,
  LearningQuestion,
  LessonMetadata,
  StudyBudget,
  StudyRecords,
  TodayPlan,
} from '../types/guide'
import type { VideoProgress } from '../types/course'
import { buildSchedule, estimateDuration, orderedRoute } from './guide.ts'
import { buildTodayPlan } from './learningFeedback.ts'
import { dailyPracticeItems } from './dailyPracticeScope.ts'
import {
  addDays,
  arrangeWork,
  budgetForDay,
  budgetTotal,
  emptyBudget,
  isLightDay,
  programDay,
  programDate,
  stageForDay,
} from './studyProgram.ts'

export interface DailyContext {
  plan: LearningPlan | null
  includeOptional: boolean
  metadata: Record<string, LessonMetadata>
  progress: Record<string, VideoProgress>
  mastery: Record<string, ConceptMastery>
  questions: LearningQuestion[]
  records: StudyRecords
  today: TodayPlan | null
  enabled?: boolean
}

function dayModule(context: DailyContext, date: string, route?: GuideLesson[]) {
  const { plan, records, progress } = context
  const modules = plan?.modules ?? []
  const scheduled =
    modules.find((m) => m.id === records.activeModuleId) ??
    (plan?.program ? stageForDay(modules, programDay(plan.program, date)) : undefined)
  if (scheduled) return scheduled
  const lessons = route ?? orderedRoute(plan?.lessons ?? [], context.includeOptional)
  const next = lessons.find((l) => !progress[l.path]?.done) ?? lessons[0]
  return modules.find((m) => m.id === next?.moduleId) ?? modules.find((m) => m.practice) ?? modules[0]
}

function dayBudget(context: DailyContext, date: string, module: KnowledgeModule | undefined, override?: number | null) {
  const program = context.plan?.program
  const day = program ? programDay(program, date) : 0
  const previous = context.today?.date === date ? context.today : null
  const selected = override === undefined ? (previous?.override ?? null) : override
  const base = program
    ? budgetForDay(program, module?.practice, day)
    : { ...emptyBudget(), video: context.plan?.dailyMinutes ?? 0 }
  const budget: StudyBudget = context.enabled === false ? emptyBudget() : { ...base }
  // 暂停、休息和归档优先于旧的单日观看覆盖值。
  if (context.enabled !== false && budgetTotal(base) > 0 && selected !== null) budget.video = selected
  return { program, day, previous, selected, base, budget }
}

/** 读取预算不生成任务、扫描元数据或计算整条路线排期。 */
export function calculateDayBudget(context: DailyContext, date: string, override?: number | null): StudyBudget {
  const module =
    context.plan?.program && context.plan.modules.some((m) => m.practice?.budget) ? dayModule(context, date) : undefined
  return dayBudget(context, date, module, override).budget
}

function dayWork(context: DailyContext, date: string, module: KnowledgeModule | undefined, budget: StudyBudget) {
  const program = context.plan?.program
  const day = program ? programDay(program, date) : 0
  const light =
    program && day <= program.days && isLightDay(program, day) && budget.recap > 0 && budget.video === 0
      ? {
          title: program.lightTask?.title ?? '轻量复盘日',
          instructions: program.lightTask?.instructions ?? '回顾本周内容，整理疑问并安排下周任务。',
          minutes: budget.recap,
        }
      : undefined
  return program && day >= 1
    ? arrangeWork({ date, moduleId: module?.id ?? '', stage: module?.practice, budget, light }, context.records)
    : context.records.entries.filter((e) => e.date === date)
}

/** 实践刷新只计算实践安排，不重新排视频。 */
export function calculateDayWork(context: DailyContext, date: string) {
  const module = dayModule(context, date)
  return dayWork(context, date, module, dayBudget(context, date, module).budget)
}

/** 首页与课程共用，只读取课程元数据，不扫描视频或启动 AI。 */
export function calculateDay(context: DailyContext, date: string, override?: number | null) {
  const { plan, progress } = context
  const route = orderedRoute(plan?.lessons ?? [], context.includeOptional)
  const module = dayModule(context, date, route)
  const { previous, selected, base, budget } = dayBudget(context, date, module, override)
  const durations = Object.fromEntries(
    [...new Set([...route.map((l) => l.path), ...Object.keys(context.metadata)])].map((path) => [
      path,
      progress[path]?.duration || context.metadata[path]?.duration || null,
    ]),
  )
  const estimate = estimateDuration(durations)
  const extraDays = previous?.extraDays ?? []
  const extraMinutes =
    context.enabled !== false && budgetTotal(base) > 0 ? extraDays.reduce((sum, entry) => sum + entry.minutes, 0) : 0
  const today = buildTodayPlan(
    route,
    durations,
    progress,
    context.mastery,
    context.questions,
    budget.video + extraMinutes,
    date,
    previous,
    selected,
    estimate,
  )
  // 提前学习只扩展视频列表，不提高今日打卡目标或改动后续日期的预算。
  today.minutes = budget.video
  if (extraDays.length) {
    today.extraDays = extraDays.map((entry) => ({ ...entry }))
    today.practiceItemIds = dailyPracticeItems(previous, date).map((item) => item.id)
  }
  const work = dayWork(context, date, module, budget)
  return {
    today,
    work,
    budget,
    module,
    route,
    durations,
    schedule: buildSchedule(route, durations, progress, plan?.dailyMinutes ?? 30, estimate),
  }
}

/** 当前视频全部完成后，按下一次有看课安排的日期追加课程。 */
export function nextStudyDay(context: DailyContext, date: string) {
  const current = context.today
  const items = current?.items.filter((item) => item.kind !== 'question') ?? []
  if (
    !context.plan ||
    context.enabled === false ||
    current?.date !== date ||
    !items.length ||
    items.some((item) => !item.done)
  )
    return null
  if (budgetTotal(calculateDayBudget(context, date)) <= 0) return null
  const program = context.plan.program
  let nextDate = addDays(current.extraDays?.at(-1)?.date ?? date, 1)
  const lastDate = program ? programDate(program, program.days) : nextDate
  for (; nextDate <= lastDate; nextDate = addDays(nextDate, 1)) {
    const day = program ? programDay(program, nextDate) : 0
    const minutes = program
      ? budgetForDay(program, stageForDay(context.plan.modules, day)?.practice, day).video
      : context.plan.dailyMinutes
    if (minutes <= 0) continue
    const extraDays = [...(current.extraDays ?? []), { date: nextDate, minutes }]
    const practiceItemIds = dailyPracticeItems(current, date).map((item) => item.id)
    const today = calculateDay({ ...context, today: { ...current, extraDays, practiceItemIds } }, date).today
    const next = today.items.find((item) => !item.done)
    return next ? { date: nextDate, minutes, today, next } : null
  }
  return null
}

export interface DaySnapshot {
  date: string
  plannedMinutes: number
  initialMinutes: number
  capturedAt: number
  tasks: Array<{ id: string; title: string; done: boolean; kind: string }>
}

export function daySnapshot(context: DailyContext, date: string): DaySnapshot {
  const result = calculateDay(context, date)
  return {
    date,
    plannedMinutes: budgetTotal(result.budget),
    initialMinutes: budgetTotal(result.budget),
    capturedAt: Date.now(),
    tasks: [
      ...result.today.items.map((item) => ({
        id: item.id,
        title: item.path.split('/').at(-1) ?? item.path,
        done: item.done,
        kind: item.kind,
      })),
      ...result.work
        .filter((item) => item.done || result.budget[item.kind] > 0)
        .map((item) => ({ id: item.id, title: item.title, done: item.done, kind: item.kind })),
    ],
  }
}

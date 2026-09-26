import type { ConceptMastery, LearningPlan, LearningQuestion, LessonMetadata, StudyBudget, StudyRecords, TodayPlan } from '../types/guide'
import type { VideoProgress } from '../types/course'
import { buildSchedule, orderedRoute } from './guide.ts'
import { buildTodayPlan } from './learningFeedback.ts'
import { arrangeWork, budgetForDay, budgetTotal, emptyBudget, isLightDay, programDay, stageForDay } from './studyProgram.ts'

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

/** 首页与课程共用，只读取课程元数据，不扫描视频或启动 AI。 */
export function calculateDay(context: DailyContext, date: string, override?: number | null) {
  const { plan, records, progress } = context
  const route = orderedRoute(plan?.lessons ?? [], context.includeOptional)
  const program = plan?.program
  const day = program ? programDay(program, date) : 0
  const next = route.find(l => !progress[l.path]?.done) ?? route[0]
  const module = plan?.modules.find(m => m.id === records.activeModuleId)
    ?? (program ? stageForDay(plan?.modules ?? [], day) : undefined)
    ?? plan?.modules.find(m => m.id === next?.moduleId)
    ?? plan?.modules.find(m => m.practice) ?? plan?.modules[0]
  const previous = context.today?.date === date ? context.today : null
  const selected = override === undefined ? previous?.override ?? null : override
  const base = program ? budgetForDay(program, module?.practice, day) : { ...emptyBudget(), video: plan?.dailyMinutes ?? 0 }
  const budget: StudyBudget = context.enabled === false ? emptyBudget() : { ...base }
  // 暂停、休息和归档优先于旧的单日观看覆盖值。
  if (context.enabled !== false && budgetTotal(base) > 0 && selected !== null) budget.video = selected
  const durations = Object.fromEntries([...new Set([...route.map(l => l.path), ...Object.keys(context.metadata)])]
    .map(path => [path, progress[path]?.duration || context.metadata[path]?.duration || null]))
  const today = buildTodayPlan(route, durations, progress, context.mastery, context.questions, budget.video, date, previous, selected)
  const light = program && day <= program.days && isLightDay(program, day) && budget.recap > 0 && budget.video === 0
    ? { title: program.lightTask?.title ?? '轻量复盘日', instructions: program.lightTask?.instructions ?? '回顾本周内容，整理疑问并安排下周任务。', minutes: budget.recap } : undefined
  const work = program && day >= 1 ? arrangeWork({ date, moduleId: module?.id ?? '', stage: module?.practice, budget, light }, records)
    : records.entries.filter(e => e.date === date)
  return { today, work, budget, module, route, durations, schedule: buildSchedule(route, durations, progress, plan?.dailyMinutes ?? 30) }
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
  return { date, plannedMinutes: budgetTotal(result.budget), initialMinutes: budgetTotal(result.budget), capturedAt: Date.now(),
    tasks: [
      ...result.today.items.map(item => ({ id: item.id, title: item.kind === 'question' ? context.questions.find(q => q.id === item.questionId)?.text ?? '处理疑问' : item.path.split('/').at(-1) ?? item.path, done: item.done, kind: item.kind })),
      ...result.work.filter(item => item.done || result.budget[item.kind] > 0).map(item => ({ id: item.id, title: item.title, done: item.done, kind: item.kind })),
    ] }
}

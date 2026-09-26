import type { LibraryCourse } from '../types/course'
import type { StudyDay } from '../types/checkIn'
import type { DailyContext, DaySnapshot } from './dailyPlan.ts'
import { isRecord, validateLearningPlan } from './guide.ts'
import { restoreFeedback } from './learningFeedback.ts'
import { parseProgram, restoreStudyRecords } from './studyProgram.ts'

export interface HomeCourse {
  course: LibraryCourse
  context: DailyContext | null
  days: Record<string, StudyDay>
  snapshots: Record<string, DaySnapshot>
  error: string
}

export function restoreHomeCourse(raw: unknown): HomeCourse {
  if (!isRecord(raw) || !isRecord(raw.course) || typeof raw.course.id !== 'string' || typeof raw.course.name !== 'string') throw new Error('课程库记录格式异常。')
  const course = raw.course as unknown as LibraryCourse
  const result: HomeCourse = { course, context: null, days: {}, snapshots: {}, error: '' }
  if (typeof raw.error === 'string') return { ...result, error: raw.error }
  try {
    if (!isRecord(raw.data)) throw new Error('课程记录读取失败。')
    const data = raw.data, guide = data.guide ?? {}
    if (!isRecord(guide) || !isRecord(data.progress) || !isRecord(data.days) || !isRecord(data.snapshots)
      || (data.records !== null && !isRecord(data.records))) throw new Error('学习记录格式异常。')
    const metadata = guide.metadata ?? {}
    const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
    if (!isRecord(metadata) || Object.values(metadata).some(value => !isRecord(value)
      || !nonnegative(value.size) || !nonnegative(value.modified)
      || (value.duration !== null && (!nonnegative(value.duration) || value.duration === 0)))) throw new Error('课节信息格式异常。')
    if (Object.values(data.progress).some(value => !isRecord(value)
      || !nonnegative(value.time) || !nonnegative(value.duration) || !nonnegative(value.updatedAt)
      || !nonnegative(value.ratio) || value.ratio > 1 || typeof value.done !== 'boolean')) throw new Error('观看进度格式异常。')
    const paths = [...new Set([
      ...Object.keys(isRecord(guide.metadata) ? guide.metadata : {}), ...Object.keys(data.progress),
      ...(isRecord(guide.plan) && Array.isArray(guide.plan.lessons) ? guide.plan.lessons.flatMap(l => isRecord(l) && typeof l.path === 'string' ? [l.path] : []) : []),
    ])]
    const plan = guide.plan ? validateLearningPlan(guide.plan, paths, true) : null
    if (plan && isRecord(guide.plan) && guide.plan.program) plan.program = parseProgram(guide.plan.program)
    const feedback = restoreFeedback(guide, paths)
    result.context = { plan, ...feedback, includeOptional: guide.includeOptional === true,
      metadata: metadata as DailyContext['metadata'], progress: data.progress as DailyContext['progress'],
      records: restoreStudyRecords(data.records), enabled: course.status === 'active' }
    for (const [date, value] of Object.entries(data.days)) {
      if (!isRecord(value) || typeof value.seconds !== 'number' || !Number.isFinite(value.seconds) || value.seconds < 0) throw new Error('学习时长记录格式异常。')
      result.days[date] = value as unknown as StudyDay
    }
    for (const [date, value] of Object.entries(data.snapshots)) {
      if (!isRecord(value) || value.date !== date || !nonnegative(value.plannedMinutes)
        || !nonnegative(value.initialMinutes) || !nonnegative(value.capturedAt)
        || !Array.isArray(value.tasks) || value.tasks.some(t => !isRecord(t) || typeof t.done !== 'boolean'
          || typeof t.title !== 'string' || typeof t.id !== 'string' || typeof t.kind !== 'string')) throw new Error('每日计划记录格式异常。')
      result.snapshots[date] = value as unknown as DaySnapshot
    }
  } catch (error) { result.context = null; result.error = (error as Error).message }
  return result
}

export function reviewDay(courses: HomeCourse[], date: string) {
  const details = courses.filter(c => c.context).map(course => {
    const videoSeconds = course.days[date]?.seconds ?? 0
    const workSeconds = course.context!.records.entries.filter(e => e.date === date).reduce((sum, entry) => sum + entry.minutes * 60, 0)
    const snapshot = course.snapshots[date]
    return { id: course.course.id, name: course.course.name, videoSeconds, workSeconds, snapshot }
  }).filter(row => row.videoSeconds > 0 || row.workSeconds > 0 || row.snapshot)
  return { date, details, videoSeconds: details.reduce((n, d) => n + d.videoSeconds, 0), workSeconds: details.reduce((n, d) => n + d.workSeconds, 0),
    plannedMinutes: details.some(d => d.snapshot) ? details.reduce((n, d) => n + (d.snapshot?.plannedMinutes ?? 0), 0) : null,
    missingPlan: details.some(d => !d.snapshot),
    tasks: details.flatMap(d => d.snapshot?.tasks ?? []),
  }
}

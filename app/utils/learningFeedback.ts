import type { ConceptMastery, GuideLesson, LearningQuestion, MasteryLevel, TodayItem, TodayPlan } from '../types/guide'
import type { VideoProgress } from '../types/course'
import { isRecord, retainPrerequisites } from './guide.ts'

export const MASTERY_LABELS: Record<MasteryLevel, string> = {
  mastered: '已掌握', uncertain: '不确定', 'needs-review': '需要补学',
}
export const QUESTION_LABELS = { open: '待解决', resolved: '已解决', 'still-confused': '仍不理解' } as const
export const masteryKey = (path: string, concept: string) => JSON.stringify([path, concept])
export const lessonConcepts = (lesson: GuideLesson) => lesson.concepts.length ? [...new Set(lesson.concepts)] : ['本课知识']

export function lessonMastery(lesson: GuideLesson, records: Record<string, ConceptMastery>): MasteryLevel | undefined {
  const levels = lessonConcepts(lesson).map(c => records[masteryKey(lesson.path, c)]?.level)
  if (levels.includes('needs-review')) return 'needs-review'
  if (levels.every(l => l === 'mastered')) return 'mastered'
  if (levels.some(Boolean)) return 'uncertain'
  return undefined
}

/** 掌握程度只来自显式反馈，观看记录不参与推断。 */
export function applyMastery(lessons: GuideLesson[], records: Record<string, ConceptMastery>) {
  const mastered = new Set<string>()
  for (const lesson of lessons) {
    // 重排后保留已反馈的知识点；AI 新增的知识点仍需单独确认。
    const markedConcepts = Object.values(records).filter(r => r.path === lesson.path).map(r => r.concept)
    if (markedConcepts.length) lesson.concepts = [...new Set([...lessonConcepts(lesson), ...markedConcepts])]
    const level = lessonMastery(lesson, records)
    if (level === 'mastered') { lesson.status = 'skipped'; mastered.add(lesson.path) }
    else if (level === 'needs-review') lesson.status = 'required'
    else if (level === 'uncertain' && lesson.status === 'skipped') lesson.status = 'optional'
  }
  retainPrerequisites(lessons, false, mastered)
  return mastered
}

export function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 当日已完成事项占用预算；长课按连续片段安排，不越过尚未学完的前置课。 */
export function buildTodayPlan(
  lessons: GuideLesson[], durations: Record<string, number | null>, progress: Record<string, VideoProgress>,
  mastery: Record<string, ConceptMastery>, questions: LearningQuestion[], minutes: number,
  date: string, previous: TodayPlan | null = null, override: number | null = null,
): TodayPlan {
  const items: TodayItem[] = previous?.date === date ? previous.items.filter(i => i.done).map(i => ({ ...i })) : []
  let available = Math.max(0, minutes * 60 - items.reduce((sum, i) => sum + i.seconds, 0))
  const question = questions.filter(q => q.status !== 'resolved' && !items.some(i => i.questionId === q.id))
    .sort((a, b) => Number(b.status === 'still-confused') - Number(a.status === 'still-confused') || a.createdAt - b.createdAt)[0]
  const reserve = question ? Math.min(300, Math.floor(available * (lessons.length ? 0.2 : 1))) : 0
  available -= reserve
  const known = Object.values(durations).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  const estimate = known.length ? known[Math.floor(known.length / 2)]! : 1200
  for (const lesson of lessons) {
    if (available <= 0) break
    const review = lessonMastery(lesson, mastery) === 'needs-review'
    const p = progress[lesson.path]
    if (p?.done && !review) continue
    const raw = durations[lesson.path]
    const duration = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : estimate
    const completedEnd = Math.max(0, ...items.filter(i => i.path === lesson.path && i.kind !== 'question').map(i => i.end))
    const start = Math.min(duration, Math.max(completedEnd, review ? 0 : p?.time || 0))
    const seconds = Math.min(available, Math.max(0, duration - start))
    if (!seconds) continue
    const kind = review ? 'review' : 'lesson'
    items.push({ id: `${date}:${kind}:${lesson.path}:${start}`, kind, path: lesson.path,
      start, end: start + seconds, seconds, estimated: duration !== raw, done: false })
    available -= seconds
  }
  if (question && reserve > 0) items.push({ id: `${date}:question:${question.id}`, kind: 'question',
    path: question.path, questionId: question.id, start: question.seconds, end: question.seconds,
    seconds: reserve, estimated: true, done: false })
  return { date, minutes, override, items }
}

/** 新增记录独立校验：旧版没有这些字段时直接使用空记录，不影响路线恢复。 */
export function restoreFeedback(raw: Record<string, unknown>, paths: string[]) {
  const known = new Set(paths)
  const mastery: Record<string, ConceptMastery> = {}
  if (isRecord(raw.mastery)) for (const entry of Object.values(raw.mastery)) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || !known.has(entry.path)
      || typeof entry.concept !== 'string' || !entry.concept.trim() || entry.concept.length > 200
      || !Object.hasOwn(MASTERY_LABELS, String(entry.level)) || typeof entry.updatedAt !== 'number' || !Number.isFinite(entry.updatedAt)) continue
    mastery[masteryKey(entry.path, entry.concept)] = { path: entry.path, concept: entry.concept, level: entry.level as MasteryLevel, updatedAt: entry.updatedAt }
  }
  const questions: LearningQuestion[] = []
  const ids = new Set<string>()
  if (Array.isArray(raw.questions)) for (const q of raw.questions) {
    if (!isRecord(q) || typeof q.id !== 'string' || ids.has(q.id) || typeof q.path !== 'string' || !known.has(q.path)
      || typeof q.text !== 'string' || !q.text.trim() || q.text.length > 3000 || !Object.hasOwn(QUESTION_LABELS, String(q.status))
      || typeof q.seconds !== 'number' || !Number.isFinite(q.seconds) || q.seconds < 0
      || typeof q.createdAt !== 'number' || !Number.isFinite(q.createdAt) || typeof q.updatedAt !== 'number' || !Number.isFinite(q.updatedAt)) continue
    ids.add(q.id)
    // 只保留推荐课节；字幕文件可能变化，重新查找时再验证精确时间。
    const recommendations = Array.isArray(q.recommendations) ? q.recommendations.flatMap(r =>
      isRecord(r) && typeof r.path === 'string' && known.has(r.path) && typeof r.reason === 'string'
        ? [{ path: r.path, reason: r.reason.slice(0, 2000) }] : []).slice(0, 3) : []
    questions.push({ id: q.id, path: q.path, text: q.text, seconds: q.seconds, status: q.status as LearningQuestion['status'],
      createdAt: q.createdAt, updatedAt: q.updatedAt, recommendations,
      reviewedPaths: Array.isArray(q.reviewedPaths) ? q.reviewedPaths.filter((p): p is string => typeof p === 'string' && known.has(p)) : [] })
  }
  let today: TodayPlan | null = null
  const t = raw.today
  if (isRecord(t) && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)
    && typeof t.minutes === 'number' && Number.isInteger(t.minutes) && t.minutes >= 5 && t.minutes <= 1440 && Array.isArray(t.items)) {
    const seen = new Set<string>()
    const items: TodayItem[] = []
    for (const i of t.items) {
      if (!isRecord(i) || typeof i.id !== 'string' || seen.has(i.id) || typeof i.path !== 'string' || !known.has(i.path)
        || !['lesson', 'review', 'question'].includes(String(i.kind)) || typeof i.done !== 'boolean'
        || typeof i.start !== 'number' || !Number.isFinite(i.start) || i.start < 0
        || typeof i.end !== 'number' || !Number.isFinite(i.end) || i.end < i.start
        || typeof i.seconds !== 'number' || !Number.isFinite(i.seconds) || i.seconds <= 0 || i.seconds > 86400) continue
      if (i.kind === 'question' && (typeof i.questionId !== 'string' || !ids.has(i.questionId))) continue
      if (i.kind !== 'question' && Math.abs(i.end - i.start - i.seconds) > 0.01) continue
      seen.add(i.id)
      items.push({ id: i.id, path: i.path, kind: i.kind as TodayItem['kind'], start: i.start, end: i.end,
        seconds: i.seconds, done: i.done, estimated: i.estimated === true, questionId: i.kind === 'question' ? String(i.questionId) : undefined })
    }
    const override = typeof t.override === 'number' && Number.isInteger(t.override) && t.override >= 5 && t.override <= 1440 ? t.override : null
    today = { date: t.date, minutes: t.minutes, override, items }
  }
  return { mastery, questions, today }
}

import type { ConceptMastery, GuideLesson, LearningQuestion, MasteryLevel, TodayItem, TodayPlan } from '../types/guide'
import type { VideoProgress } from '../types/course'
import { estimateDuration, isRecord, retainPrerequisites } from './guide.ts'
import { validDate } from './studyProgram.ts'

export const MASTERY_LABELS: Record<MasteryLevel, string> = {
  mastered: '已掌握',
  uncertain: '不确定',
  'needs-review': '需要补学',
}
export const QUESTION_LABELS = { open: '待解决', resolved: '已解决', 'still-confused': '仍不理解' } as const
export const masteryKey = (path: string, concept: string) => JSON.stringify([path, concept])
export const lessonConcepts = (lesson: GuideLesson) =>
  lesson.concepts.length ? [...new Set(lesson.concepts)] : ['本课知识']

export function lessonMastery(lesson: GuideLesson, records: Record<string, ConceptMastery>): MasteryLevel | undefined {
  const levels = lessonConcepts(lesson).map((c) => records[masteryKey(lesson.path, c)]?.level)
  if (levels.includes('needs-review')) return 'needs-review'
  if (levels.every((l) => l === 'mastered')) return 'mastered'
  if (levels.some(Boolean)) return 'uncertain'
  return undefined
}

/** 掌握程度只来自显式反馈，观看记录不参与推断。 */
export function applyMastery(
  lessons: GuideLesson[],
  records: Record<string, ConceptMastery>,
  excludedPrerequisites = new Set<string>(),
) {
  const mastered = new Set<string>()
  for (const lesson of lessons) {
    // 重排后保留已反馈的知识点；AI 新增的知识点仍需单独确认。
    const markedConcepts = Object.values(records)
      .filter((r) => r.path === lesson.path)
      .map((r) => r.concept)
    if (markedConcepts.length) lesson.concepts = [...new Set([...lessonConcepts(lesson), ...markedConcepts])]
    const level = lessonMastery(lesson, records)
    if (level === 'mastered') {
      lesson.status = 'skipped'
      mastered.add(lesson.path)
    } else if (level === 'needs-review') lesson.status = 'required'
    else if (level === 'uncertain' && lesson.status === 'skipped') lesson.status = 'optional'
  }
  retainPrerequisites(lessons, false, new Set([...mastered, ...excludedPrerequisites]))
  return mastered
}

export function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 当日已完成事项占用预算；长课按连续片段安排，不越过尚未学完的前置课。 */
export function buildTodayPlan(
  lessons: GuideLesson[],
  durations: Record<string, number | null>,
  progress: Record<string, VideoProgress>,
  mastery: Record<string, ConceptMastery>,
  _legacyQuestions: LearningQuestion[],
  minutes: number,
  date: string,
  previous: TodayPlan | null = null,
  override: number | null = null,
  estimate = estimateDuration(durations),
): TodayPlan {
  const previousItems = previous?.date === date ? previous.items.filter((i) => i.kind !== 'question') : []
  const byPath = new Map(lessons.map((lesson) => [lesson.path, lesson]))
  const reviewByPath = new Map<string, boolean>()
  function needsReview(path: string) {
    if (!reviewByPath.has(path)) {
      const lesson = byPath.get(path)
      reviewByPath.set(path, !!lesson && lessonMastery(lesson, mastery) === 'needs-review')
    }
    return reviewByPath.get(path)!
  }
  // 播放进度可能先于片段提醒写入；已安排且看完的课节必须留下，不能在重排时直接跳过。
  const items: TodayItem[] = previousItems
    .filter(
      (item) =>
        item.done ||
        (item.kind === 'lesson' &&
          byPath.has(item.path) &&
          !needsReview(item.path) &&
          (progress[item.path]?.done || (progress[item.path]?.time ?? 0) >= item.end)),
    )
    .map((item) => ({ ...item, done: true }))
  let available = Math.max(0, minutes * 60 - items.reduce((sum, i) => sum + i.seconds, 0))
  const completedEnds = new Map<string, number>()
  for (const item of items) completedEnds.set(item.path, Math.max(completedEnds.get(item.path) ?? 0, item.end))
  const pendingByPath = new Map<string, TodayItem[]>()
  for (const item of previousItems) {
    if (item.done) continue
    const pending = pendingByPath.get(item.path) ?? []
    pending.push(item)
    pendingByPath.set(item.path, pending)
  }
  for (const lesson of lessons) {
    if (available <= 0) break
    const review = needsReview(lesson.path)
    const kind = review ? 'review' : 'lesson'
    const p = progress[lesson.path]
    if (p?.done && !review) continue
    const raw = durations[lesson.path]
    const duration = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : estimate
    const completedEnd = completedEnds.get(lesson.path) ?? 0
    const pending = pendingByPath.get(lesson.path)?.find((item) => item.kind === kind && item.end > completedEnd)
    // 同一天刷新沿用原片段起点，已投入的观看时间仍占预算，避免边看边补入后续课程。
    const start = Math.min(duration, Math.max(completedEnd, pending?.start ?? (review ? 0 : p?.time || 0)))
    const seconds = Math.min(available, Math.max(0, duration - start))
    if (!seconds) continue
    items.push({
      id: pending?.start === start ? pending.id : `${date}:${kind}:${lesson.path}:${start}`,
      kind,
      path: lesson.path,
      start,
      end: start + seconds,
      seconds,
      estimated: duration !== raw,
      done: false,
    })
    completedEnds.set(lesson.path, start + seconds)
    available -= seconds
  }
  return { date, minutes, override, items }
}

/** 新增记录独立校验：旧版没有这些字段时直接使用空记录，不影响路线恢复。 */
export function restoreFeedback(raw: Record<string, unknown>, paths: string[]) {
  const known = new Set(paths)
  const mastery: Record<string, ConceptMastery> = {}
  if (isRecord(raw.mastery))
    for (const entry of Object.values(raw.mastery)) {
      if (
        !isRecord(entry) ||
        typeof entry.path !== 'string' ||
        !known.has(entry.path) ||
        typeof entry.concept !== 'string' ||
        !entry.concept.trim() ||
        entry.concept.length > 200 ||
        !Object.hasOwn(MASTERY_LABELS, String(entry.level)) ||
        typeof entry.updatedAt !== 'number' ||
        !Number.isFinite(entry.updatedAt)
      )
        continue
      mastery[masteryKey(entry.path, entry.concept)] = {
        path: entry.path,
        concept: entry.concept,
        level: entry.level as MasteryLevel,
        updatedAt: entry.updatedAt,
      }
    }
  const questions: LearningQuestion[] = []
  const ids = new Set<string>()
  if (Array.isArray(raw.questions))
    for (const q of raw.questions) {
      if (
        !isRecord(q) ||
        typeof q.id !== 'string' ||
        ids.has(q.id) ||
        typeof q.path !== 'string' ||
        !known.has(q.path) ||
        typeof q.text !== 'string' ||
        !q.text.trim() ||
        q.text.length > 3000 ||
        !Object.hasOwn(QUESTION_LABELS, String(q.status)) ||
        typeof q.seconds !== 'number' ||
        !Number.isFinite(q.seconds) ||
        q.seconds < 0 ||
        typeof q.createdAt !== 'number' ||
        !Number.isFinite(q.createdAt) ||
        typeof q.updatedAt !== 'number' ||
        !Number.isFinite(q.updatedAt)
      )
        continue
      ids.add(q.id)
      // 只保留推荐课节；字幕文件可能变化，重新查找时再验证精确时间。
      const recommendations = Array.isArray(q.recommendations)
        ? q.recommendations
            .flatMap((r) =>
              isRecord(r) && typeof r.path === 'string' && known.has(r.path) && typeof r.reason === 'string'
                ? [{ path: r.path, reason: r.reason.slice(0, 2000) }]
                : [],
            )
            .slice(0, 3)
        : []
      questions.push({
        id: q.id,
        path: q.path,
        text: q.text,
        seconds: q.seconds,
        status: q.status as LearningQuestion['status'],
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
        recommendations,
        reviewedPaths: Array.isArray(q.reviewedPaths)
          ? q.reviewedPaths.filter((p): p is string => typeof p === 'string' && known.has(p))
          : [],
      })
    }
  let today: TodayPlan | null = null
  const t = raw.today
  if (
    isRecord(t) &&
    typeof t.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
    typeof t.minutes === 'number' &&
    Number.isInteger(t.minutes) &&
    t.minutes >= 0 &&
    t.minutes <= 1440 &&
    Array.isArray(t.items)
  ) {
    const seen = new Set<string>()
    const items: TodayItem[] = []
    for (const i of t.items) {
      if (
        !isRecord(i) ||
        typeof i.id !== 'string' ||
        seen.has(i.id) ||
        typeof i.path !== 'string' ||
        !known.has(i.path) ||
        !['lesson', 'review', 'question'].includes(String(i.kind)) ||
        typeof i.done !== 'boolean' ||
        typeof i.start !== 'number' ||
        !Number.isFinite(i.start) ||
        i.start < 0 ||
        typeof i.end !== 'number' ||
        !Number.isFinite(i.end) ||
        i.end < i.start ||
        typeof i.seconds !== 'number' ||
        !Number.isFinite(i.seconds) ||
        i.seconds <= 0 ||
        i.seconds > 86400
      )
        continue
      if (i.kind === 'question' && (typeof i.questionId !== 'string' || !ids.has(i.questionId))) continue
      if (i.kind !== 'question' && Math.abs(i.end - i.start - i.seconds) > 0.01) continue
      seen.add(i.id)
      items.push({
        id: i.id,
        path: i.path,
        kind: i.kind as TodayItem['kind'],
        start: i.start,
        end: i.end,
        seconds: i.seconds,
        done: i.done,
        estimated: i.estimated === true,
        questionId: i.kind === 'question' ? String(i.questionId) : undefined,
      })
    }
    const override =
      typeof t.override === 'number' && Number.isInteger(t.override) && t.override >= 5 && t.override <= 1440
        ? t.override
        : null
    today = { date: t.date, minutes: t.minutes, override, items }
    if (Array.isArray(t.extraDays)) {
      const extraDays: NonNullable<TodayPlan['extraDays']> = []
      for (const entry of t.extraDays.slice(0, 1095)) {
        if (
          !isRecord(entry) ||
          !validDate(entry.date) ||
          entry.date <= (extraDays.at(-1)?.date ?? t.date) ||
          typeof entry.minutes !== 'number' ||
          !Number.isInteger(entry.minutes) ||
          entry.minutes <= 0 ||
          entry.minutes > 1440
        )
          continue
        extraDays.push({ date: entry.date, minutes: entry.minutes })
      }
      if (extraDays.length) today.extraDays = extraDays
    }
    if (
      today.extraDays?.length &&
      Array.isArray(t.practiceItemIds) &&
      t.practiceItemIds.length &&
      t.practiceItemIds.every(
        (id) => typeof id === 'string' && items.some((item) => item.id === id && item.kind !== 'question'),
      ) &&
      new Set(t.practiceItemIds).size === t.practiceItemIds.length
    ) {
      today.practiceItemIds = [...t.practiceItemIds] as string[]
    }
  }
  return { mastery, questions, today }
}

import type { LearningManagementData, ReviewCard, Recall, LearningSources, FlowMood } from '../types/learningManagement'
import type { HomeCourse } from './learningHome'
import { isRecord } from './guide.ts'
import { addDays, validDate, checkKey } from './studyProgram.ts'
import { localDayKey } from './learningFeedback.ts'
import { restorePractice } from './practice.ts'

export const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30] as const
export const FLOW_LABELS: Record<FlowMood, string> = {
  deep: '🚀 深度心流',
  steady: '😊 轻松跟上',
  struggling: '🤯 概念吃力',
  tired: '🥱 疲劳走神',
}
export function emptyLearningManagement(): LearningManagementData {
  return {
    version: 1,
    cards: [],
    rewardDays: [],
    flows: [],
    contracts: [],
    works: [],
    protections: [],
    preferences: {
      flowPrompt: true,
      quietFocus: true,
      shortcut: '',
      calendarTime: '20:00',
      calendarDays: 30,
      calendarEnabled: false,
    },
  }
}
const text = (v: unknown, max = 12000): v is string => typeof v === 'string' && v.length <= max
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const id = (v: unknown): v is string => text(v, 4000) && v.length > 0
const recall = (v: unknown) => ['remembered', 'uncertain', 'forgotten'].includes(String(v))
/** Absent settings migrate to defaults. Invalid/future records fail closed, never replacing saved work. */
export function parseLearningManagement(raw: unknown): LearningManagementData {
  if (raw == null) return emptyLearningManagement()
  if (!isRecord(raw) || raw.version !== 1) throw Error('学习管理记录版本无法读取。')
  const arrays = ['cards', 'rewardDays', 'flows', 'contracts', 'works', 'protections'] as const
  for (const key of arrays) if (!Array.isArray(raw[key])) throw Error('学习管理记录不完整。')
  const data = raw as unknown as LearningManagementData
  const unique = (values: { id: string }[]) => new Set(values.map((v) => v.id)).size === values.length
  if (
    !unique(data.cards) ||
    !unique(data.works) ||
    !unique(data.contracts) ||
    !unique(data.flows) ||
    data.cards.some(
      (c) =>
        !isRecord(c) ||
        !id(c.id) ||
        !id(c.courseId) ||
        !id(c.path) ||
        !['knowledge', 'note', 'practice'].includes(c.kind) ||
        !text(c.front) ||
        !text(c.back, 100000) ||
        !Array.isArray(c.concepts) ||
        !c.concepts.every((v) => text(v, 500)) ||
        !text(c.category, 100) ||
        !number(c.seconds) ||
        !number(c.sourceAt) ||
        !validDate(c.due) ||
        !Number.isInteger(c.step) ||
        c.step < 0 ||
        c.step > 5 ||
        (c.recall !== null && !recall(c.recall)) ||
        (c.reviewedAt !== null && !number(c.reviewedAt)) ||
        typeof c.weak !== 'boolean',
    ) ||
    data.rewardDays.some((d) => !validDate(d)) ||
    data.flows.some(
      (f) =>
        !isRecord(f) ||
        !id(f.id) ||
        !text(f.courseId) ||
        !text(f.path) ||
        !number(f.startedAt) ||
        !number(f.endedAt) ||
        f.endedAt < f.startedAt ||
        !Number.isInteger(f.hour) ||
        f.hour < 0 ||
        f.hour > 23 ||
        !Object.hasOwn(FLOW_LABELS, f.mood),
    ) ||
    data.contracts.some(
      (c) =>
        !isRecord(c) ||
        !id(c.id) ||
        !id(c.courseId) ||
        !text(c.moduleId) ||
        !id(c.goal) ||
        !validDate(c.deadline) ||
        !Number.isInteger(c.minutes) ||
        c.minutes < 5 ||
        c.minutes > 1440 ||
        !number(c.signedAt),
    ) ||
    data.works.some(
      (w) =>
        !isRecord(w) ||
        !id(w.id) ||
        !id(w.courseId) ||
        !text(w.moduleId) ||
        !id(w.title) ||
        !text(w.description) ||
        !text(w.location) ||
        !text(w.screenshot, 3000000) ||
        (w.screenshot !== '' && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(w.screenshot)) ||
        !number(w.createdAt) ||
        (w.acceptedAt !== null && !number(w.acceptedAt)),
    ) ||
    data.protections.some(
      (p) =>
        !isRecord(p) ||
        !id(p.courseId) ||
        !validDate(p.date) ||
        !['freeze', 'makeup'].includes(p.kind) ||
        !number(p.at),
    )
  )
    throw Error('学习管理记录格式异常。')
  const p = data.preferences
  if (
    !isRecord(p) ||
    typeof p.flowPrompt !== 'boolean' ||
    typeof p.quietFocus !== 'boolean' ||
    !text(p.shortcut, 200) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.calendarTime) ||
    !Number.isInteger(p.calendarDays) ||
    p.calendarDays < 1 ||
    p.calendarDays > 90 ||
    typeof p.calendarEnabled !== 'boolean'
  )
    throw Error('学习管理设置无效。')
  return structuredClone(data)
}

export function parseLearningSources(raw: unknown): LearningSources {
  if (!isRecord(raw) || !Array.isArray(raw.practices) || !Array.isArray(raw.notes) || !Array.isArray(raw.summaries))
    throw Error('复习材料读取失败。')
  const result: LearningSources = { practices: [], notes: [], summaries: [] }
  for (const group of raw.practices) {
    if (!isRecord(group) || !id(group.courseId) || !Array.isArray(group.records)) throw Error('练习材料格式异常。')
    const paths = group.records.flatMap((r) => (isRecord(r) && id(r.path) ? [r.path] : []))
    const sourcePaths = group.records.flatMap((r) =>
      isRecord(r) && Array.isArray(r.sources)
        ? r.sources.flatMap((s) => (isRecord(s) && id(s.path) ? [s.path] : []))
        : [],
    )
    const records = restorePractice(group.records, paths, 1000, [...paths, ...sourcePaths])
    if (records.length !== group.records.length) throw Error('部分练习记录无法读取。')
    result.practices.push(...records.map((record) => ({ courseId: group.courseId as string, record })))
  }
  for (const n of raw.notes) {
    if (!isRecord(n) || !id(n.courseId) || !id(n.path) || !text(n.content, 2000000) || !number(n.updatedAt))
      throw Error('笔记材料格式异常。')
    result.notes.push(n as unknown as LearningSources['notes'][number])
  }
  for (const s of raw.summaries) {
    if (
      !isRecord(s) ||
      !id(s.courseId) ||
      !id(s.path) ||
      !number(s.createdAt) ||
      !text(s.overview, 100000) ||
      !Array.isArray(s.points) ||
      s.points.some((p) => !isRecord(p) || !id(p.id) || !text(p.title) || !text(p.text, 100000) || !number(p.start))
    )
      throw Error('知识点材料格式异常。')
    result.summaries.push(s as unknown as LearningSources['summaries'][number])
  }
  return result
}

/** Stable source keys preserve schedules across reloads; newly graded mistakes re-enter today's queue. */
export function collectReviewCards(sources: LearningSources, courses: HomeCourse[], today: string): ReviewCard[] {
  const cards: ReviewCard[] = []
  const courseMap = new Map(courses.map((c) => [c.course.id, c]))
  function add(c: Omit<ReviewCard, 'due' | 'step' | 'recall' | 'reviewedAt'>, initialRecall: Recall | null = null) {
    cards.push({
      ...c,
      due: c.weak ? today : addDays(localDayKey(new Date(c.sourceAt)), 1),
      step: 0,
      recall: initialRecall,
      reviewedAt: null,
    })
  }
  for (const { courseId, record: r } of sources.practices) {
    const last = r.attempts.at(-1)
    if (!last || !courseMap.has(courseId)) continue
    const source = r.sources.find((s) => s.path)
    const path = r.path.startsWith('daily:') ? source?.path : r.path
    if (!path) continue
    add(
      {
        id: JSON.stringify(['practice', courseId, r.id]),
        courseId,
        path,
        kind: 'practice',
        front:
          r.question.prompt +
          ('options' in r.question ? '\n\n' + r.question.options.map((o) => `${o.id}. ${o.text}`).join('\n\n') : ''),
        back: r.question.referenceAnswer,
        concepts: r.question.concepts,
        category: r.question.knowledge?.category ?? 'uncategorized',
        seconds: source?.start ?? r.scope?.start ?? 0,
        sourceAt: last.at,
        weak: last.feedback.result !== 'solid',
      },
      last.feedback.result === 'partial' ? 'uncertain' : last.feedback.result === 'retry' ? 'forgotten' : null,
    )
  }
  for (const s of sources.summaries) {
    if (!courseMap.get(s.courseId)?.context?.progress[s.path]?.done) continue
    for (const p of s.points)
      add({
        id: JSON.stringify(['knowledge', s.courseId, s.path, p.id]),
        courseId: s.courseId,
        path: s.path,
        kind: 'knowledge',
        front: p.title,
        back: p.text,
        concepts: [p.title],
        category: 'concept',
        seconds: p.start,
        sourceAt: s.createdAt,
        weak: false,
      })
  }
  for (const n of sources.notes) {
    if (!courseMap.get(n.courseId)?.context?.progress[n.path]?.done || !n.content.trim()) continue
    // Headings form recall prompts; an unstructured note remains one complete card.
    const sections = n.content.split(/\n(?=#{1,6}\s)/u)
    const occurrences = new Map<string, number>()
    for (const section of sections) {
      const heading = section.match(/^#{1,6}\s+(.+)\n/u)
      const front = heading?.[1]?.trim() ?? `${n.path.split('/').at(-1)} · 重点笔记`
      const index = occurrences.get(front) ?? 0
      occurrences.set(front, index + 1)
      const back = section.slice(heading?.[0].length ?? 0).trim()
      if (!back) continue
      add({
        id: JSON.stringify(['note', n.courseId, n.path, front, index]),
        courseId: n.courseId,
        path: n.path,
        kind: 'note',
        front,
        back: back.slice(0, 100000),
        concepts: [front],
        category: 'note',
        seconds: 0,
        sourceAt: n.updatedAt,
        weak: false,
      })
    }
  }
  for (const course of courses)
    for (const mastery of Object.values(course.context?.mastery ?? {})) {
      if (mastery.level === 'mastered') continue
      const summary = sources.summaries.find((s) => s.courseId === course.course.id && s.path === mastery.path)
      const point = summary?.points.find((p) => p.title.includes(mastery.concept) || mastery.concept.includes(p.title))
      const note = sources.notes.find((n) => n.courseId === course.course.id && n.path === mastery.path)
      add({
        id: JSON.stringify(['mastery', course.course.id, mastery.path, mastery.concept]),
        courseId: course.course.id,
        path: mastery.path,
        kind: 'knowledge',
        front: mastery.concept,
        back: point?.text ?? note?.content.slice(0, 100000) ?? summary?.overview ?? '回看原课节，重新梳理这个概念。',
        concepts: [mastery.concept],
        category: 'concept',
        seconds: point?.start ?? 0,
        sourceAt: mastery.updatedAt,
        weak: true,
      })
    }
  return cards
}
export function mergeReviewCards(saved: ReviewCard[], collected: ReviewCard[]): ReviewCard[] {
  const result = new Map(saved.map((c) => [c.id, c]))
  for (const card of collected) {
    const old = result.get(card.id)
    if (!old) result.set(card.id, card)
    else if (old.sourceAt !== card.sourceAt || old.front !== card.front || old.back !== card.back) {
      const mistaken = card.weak && card.sourceAt > (old.reviewedAt ?? 0)
      result.set(card.id, {
        ...old,
        ...card,
        step: mistaken ? 0 : old.step,
        due: mistaken ? card.due : old.due,
        reviewedAt: old.reviewedAt,
        recall: mistaken ? (card.recall ?? 'forgotten') : old.recall,
        weak: card.kind === 'practice' || mistaken ? card.weak : old.weak,
      })
    }
  }
  return [...result.values()]
}
export function rateReview(card: ReviewCard, rating: Recall, now: number): ReviewCard {
  if (!recall(rating) || !number(now)) throw Error('复习评价无效。')
  const today = localDayKey(new Date(now))
  if (card.reviewedAt !== null && localDayKey(new Date(card.reviewedAt)) === today) throw Error('这张卡片今天已复习。')
  const step =
    rating === 'remembered' ? Math.min(5, card.step + 1) : rating === 'uncertain' ? Math.max(0, card.step - 1) : 0
  return {
    ...card,
    recall: rating,
    step,
    reviewedAt: now,
    weak: rating !== 'remembered',
    due: addDays(today, rating === 'forgotten' ? 1 : REVIEW_INTERVALS[step]!),
  }
}
export function dueReviewCards(data: LearningManagementData, courses: HomeCourse[], today: string) {
  const active = new Set(courses.filter((c) => c.course.status === 'active').map((c) => c.course.id))
  return data.cards
    .filter(
      (c) =>
        active.has(c.courseId) &&
        c.due <= today &&
        (c.reviewedAt === null || localDayKey(new Date(c.reviewedAt)) !== today),
    )
    .sort((a, b) => a.due.localeCompare(b.due) || Number(b.weak) - Number(a.weak) || a.id.localeCompare(b.id))
}
export function recordReview(
  data: LearningManagementData,
  courses: HomeCourse[],
  id: string,
  recall: Recall,
  now: number,
) {
  const day = localDayKey(new Date(now))
  const index = data.cards.findIndex((c) => c.id === id)
  if (index < 0 || !dueReviewCards(data, courses, day).some((c) => c.id === id)) throw Error('这张卡片今天已复习。')
  data.cards[index] = rateReview(data.cards[index]!, recall, now)
  if (!dueReviewCards(data, courses, day).length && !data.rewardDays.includes(day)) {
    data.rewardDays.push(day)
    return true
  }
  return false
}
export function canMakeUp(course: HomeCourse, date: string, today: string) {
  if (date >= today || date < addDays(today, -30) || course.days[date]?.checkedAt != null) return false
  const snapshot = course.snapshots[date]
  if (!snapshot?.tasks.length || snapshot.plannedMinutes <= 0) return false
  return snapshot.tasks.every(
    (t) =>
      t.done ||
      (t.path &&
        t.end !== undefined &&
        ((course.context?.progress[t.path]?.done ?? false) ||
          (course.context?.today?.completedBeforeToday?.[t.path] ?? 0) >= t.end)) ||
      course.context?.records.entries.some((e) => e.id === t.id && e.done),
  )
}
export function addProtection(
  data: LearningManagementData,
  course: HomeCourse,
  date: string,
  kind: 'freeze' | 'makeup',
  now: number,
) {
  const today = localDayKey(new Date(now))
  if (
    !validDate(date) ||
    date >= today ||
    course.days[date]?.checkedAt != null ||
    data.protections.some((p) => p.courseId === course.course.id && p.date === date)
  )
    throw Error('这个日期无需补卡。')
  if (kind === 'makeup') {
    if (!canMakeUp(course, date, today)) throw Error('完成当日积压课节后可补卡。')
  } else {
    if (date !== addDays(today, -1) || !(course.snapshots[date]?.plannedMinutes || course.days[date]?.targetSeconds))
      throw Error('防断卡能量可保护昨天的学习计划。')
    const month = today.slice(0, 7)
    if (
      data.protections.filter((p) => p.kind === 'freeze' && localDayKey(new Date(p.at)).startsWith(month)).length >= 2
    )
      throw Error('本月防断卡能量已用完。')
  }
  data.protections.push({ courseId: course.course.id, date, kind, at: now })
}
export function protectedStreak(course: HomeCourse, data: LearningManagementData, today: string) {
  const protectedDays = new Set(data.protections.filter((p) => p.courseId === course.course.id).map((p) => p.date))
  const checked = (d: string) => course.days[d]?.checkedAt != null || protectedDays.has(d)
  let date = checked(today) ? today : addDays(today, -1),
    count = 0
  for (; count < 36500 && checked(date); date = addDays(date, -1)) count++
  return count
}
export function canAcceptWork(course: HomeCourse, moduleId: string) {
  const checks = course.context?.plan?.modules.find((m) => m.id === moduleId)?.practice?.checks ?? []
  return checks.every((c) => course.context?.records.checks[checkKey(moduleId, c.id)]?.passed)
}

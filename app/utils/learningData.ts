import { databaseRequest, flushDatabaseWrites, type DatabaseCollection, type DatabaseOptions } from '~/utils/database'
import { subscribeDatabaseChanges } from './databaseChanges.ts'
import { incrementalCache } from './incrementalCache.ts'
import { isRecord } from './guide.ts'
import { restoreHomeCourse, type HomeCourse } from './learningHome.ts'
import { collectReviewCards, parseLearningSources } from './learningManagement.ts'
import type { LearningSources, ReviewCard } from '../types/learningManagement'

function courseId(collection: DatabaseCollection, options: DatabaseOptions): string | undefined {
  const body = isRecord(options.body) ? options.body : {}
  const id = body.courseId ?? body.id ?? options.query?.courseId ?? options.query?.id
  if (typeof id === 'string') return id
  if (collection === 'settings' && typeof body.key === 'string') {
    const match = /^(study-records:|daily-practice:|lesson-knowledge:)(.*)$/u.exec(body.key)
    if (!match) return
    if (match[1] !== 'lesson-knowledge:') return match[2]
    try {
      const key: unknown = JSON.parse(match[2]!)
      if (Array.isArray(key) && typeof key[0] === 'string') return key[0]
    } catch {
      /* An unknown key invalidates the whole collection. */
    }
  }
}

export function createLearningData(request: typeof databaseRequest) {
  const dashboard = incrementalCache(
    async (id) => {
      const raw = await request<unknown>('dashboard', { query: id ? { courseId: id } : {} })
      if (
        !Array.isArray(raw) ||
        raw.some((r) => !isRecord(r) || !isRecord(r.course) || typeof r.course.id !== 'string')
      )
        throw Error('课程库读取失败。')
      return raw as Array<{ course: { id: string; pinned: boolean; lastOpenedAt: number } }>
    },
    (all, update, id) => {
      const replaced = new Set([id, ...update.map((r) => r.course.id)])
      return [...all.filter((r) => !replaced.has(r.course.id)), ...update].sort(
        (a, b) => Number(b.course.pinned) - Number(a.course.pinned) || b.course.lastOpenedAt - a.course.lastOpenedAt,
      )
    },
  )
  const sources = incrementalCache(
    async (id) => {
      const raw = await request('learning-sources', { query: id ? { courseId: id } : {} })
      return {
        ...parseLearningSources(raw),
        courseId: isRecord(raw) && typeof raw.courseId === 'string' ? raw.courseId : id,
      }
    },
    (all, update, id) => {
      const replaced = new Set([id, update.courseId])
      return {
        courseId: undefined,
        notes: [...all.notes.filter((r) => !replaced.has(r.courseId)), ...update.notes],
        practices: [...all.practices.filter((r) => !replaced.has(r.courseId)), ...update.practices],
        summaries: [...all.summaries.filter((r) => !replaced.has(r.courseId)), ...update.summaries],
      }
    },
  )
  const restored = new WeakMap<object, { date: string; course: HomeCourse }>()
  async function courses(date: string) {
    return (await dashboard.load()).map((raw) => {
      let entry = restored.get(raw)
      if (!entry || entry.date !== date) {
        entry = { date, course: restoreHomeCourse(raw, date) }
        restored.set(raw, entry)
      }
      return entry.course
    })
  }
  function invalidate(collection: DatabaseCollection, options: DatabaseOptions) {
    const id = courseId(collection, options)
    const key = isRecord(options.body) && typeof options.body.key === 'string' ? options.body.key : ''
    const material =
      ['notes', 'practice'].includes(collection) ||
      (collection === 'settings' && /^(lesson-knowledge:|daily-practice:)/u.test(key))
    const planning =
      ['recent-courses', 'library', 'learning-plan', 'guide', 'progress', 'check-in', 'day-snapshots'].includes(
        collection,
      ) ||
      (collection === 'settings' && /^(study-records:|daily-practice:)/u.test(key))
    if (material) sources.invalidate(id)
    if (planning) dashboard.invalidate(id)
    return material || planning
  }
  return {
    courses,
    sources: sources.load,
    invalidate,
    reset: () => {
      dashboard.invalidate()
      sources.invalidate()
    },
  }
}

const shared = createLearningData(databaseRequest)
subscribeDatabaseChanges(shared.invalidate)
export async function readLearningCourses(date: string) {
  await flushDatabaseWrites()
  return shared.courses(date)
}
export async function readLearningSources() {
  await flushDatabaseWrites()
  return shared.sources()
}
export const resetLearningData = shared.reset

/** Rebuild recall material only for courses whose contents or scheduling state changed. */
export function createReviewIndex(collect = collectReviewCards) {
  const cache = new Map<string, { course: HomeCourse; date: string; sources: LearningSources; cards: ReviewCard[] }>()
  return (sources: LearningSources, courses: HomeCourse[], date: string) => {
    const grouped = new Map(
      courses.map((c) => [c.course.id, { notes: [], practices: [], summaries: [] } as LearningSources]),
    )
    for (const key of ['notes', 'practices', 'summaries'] as const)
      for (const item of sources[key]) (grouped.get(item.courseId)?.[key] as unknown[] | undefined)?.push(item)
    const cards: ReviewCard[] = []
    for (const course of courses) {
      const id = course.course.id,
        items = grouped.get(id)!,
        old = cache.get(id)
      const same =
        old &&
        old.course === course &&
        old.date === date &&
        (['notes', 'practices', 'summaries'] as const).every(
          (key) =>
            items[key].length === old.sources[key].length &&
            items[key].every((item, i) => item === old.sources[key][i]),
        )
      const next = same ? old : { course, date, sources: items, cards: collect(items, [course], date) }
      cache.set(id, next)
      cards.push(...next.cards)
    }
    for (const id of cache.keys()) if (!grouped.has(id)) cache.delete(id)
    return cards
  }
}

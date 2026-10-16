import type { LibraryCourse } from '../types/course'
import type { HomeCourse } from './learningHome'
import { buildSchedule, estimateDuration } from './guide.ts'
import { isPaused } from './studyProgram.ts'

export type CourseProgressState = 'new' | 'started' | 'done'

export function normalizeCourseName(value: string) {
  const name = value.trim()
  const characters = [...name]
  if (
    !characters.length ||
    characters.length > 120 ||
    characters.some((character) => {
      const code = character.codePointAt(0)!
      return code < 32 || (code >= 127 && code <= 159)
    })
  )
    throw new Error('课程名称应为 1–120 个字符')
  return name
}

export function courseLibraryStatus(entry: HomeCourse, date: string): LibraryCourse['status'] {
  return entry.course.status === 'active' && isPaused(entry.context?.plan?.program, date)
    ? 'paused'
    : entry.course.status
}

export function courseLibraryProgress(entry: HomeCourse) {
  if (entry.error || !entry.context) return null
  const progress = Object.values(entry.context.progress)
  const total = entry.course.videoCount
  const done = Math.min(total, progress.filter((item) => item.done).length)
  const state: CourseProgressState =
    total > 0 && done === total
      ? 'done'
      : progress.some((item) => item.done || item.ratio > 0 || item.time > 0)
        ? 'started'
        : 'new'
  return { done, percent: total ? Math.round((done / total) * 100) : 0, state }
}

export function searchCourseLibrary(entries: HomeCourse[], search: string) {
  const query = search.trim().toLocaleLowerCase()
  return entries
    .filter((entry) => !query || entry.course.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(b.course.pinned) - Number(a.course.pinned) || b.course.lastOpenedAt - a.course.lastOpenedAt)
}

/** 课程卡片统计完整课程，包含未纳入学习路线的课节。 */
export function courseLibraryRemaining(entry: HomeCourse) {
  if (entry.error || !entry.context) return null
  if (!entry.course.videoCount) return { seconds: 0, estimated: false }
  const { metadata, progress, plan } = entry.context
  const paths = [
    ...new Set([
      ...Object.keys(metadata),
      ...Object.keys(progress),
      ...(plan?.lessons.map((lesson) => lesson.path) ?? []),
    ]),
  ]
  const missing = Math.max(0, entry.course.videoCount - paths.length)
  const remaining = paths.filter((path) => !progress[path]?.done)
  if (!remaining.length && !missing) return { seconds: 0, estimated: false }
  const durations = Object.fromEntries(
    paths.map((path) => [path, progress[path]?.duration || metadata[path]?.duration || null]),
  )
  const estimated = missing > 0 || remaining.some((path) => durations[path] === null)
  if (estimated && !Object.values(durations).some((duration) => duration !== null)) return null
  const estimate = estimateDuration(durations)
  const schedule = buildSchedule(
    remaining.map((path) => ({ path, moduleId: '', status: 'required', concepts: [], prerequisites: [], reason: '' })),
    durations,
    progress,
    30,
    estimate,
  )
  return { seconds: schedule.remainingSeconds + missing * estimate, estimated }
}

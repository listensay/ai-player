import type { TodayPlan } from '../types/guide'
import type { VideoProgress } from '../types/course'
import { isRecord } from './guide.ts'
import { validDate } from './studyProgram.ts'

export const SEGMENT_EPSILON = 0.01

/** Earlier-day completion is independent of the player's last playback position. */
export function completedBeforeDay(today: TodayPlan | null, date: string): Record<string, number> {
  if (!today || today.date > date) return {}
  const completed = { ...today.completedBeforeToday }
  if (today.date < date)
    for (const item of today.items) {
      if (item.done && item.kind !== 'question') completed[item.path] = Math.max(completed[item.path] ?? 0, item.end)
    }
  return completed
}

export function progressForPlanning(
  progress: Record<string, VideoProgress>,
  metadata: Record<string, { duration: number | null }>,
  today: TodayPlan | null,
  date: string,
) {
  const completed = completedBeforeDay(today, date)
  if (!Object.keys(completed).length) return progress
  const result = { ...progress }
  for (const [path, end] of Object.entries(completed)) {
    const old = progress[path]
    const duration = old?.duration || metadata[path]?.duration || 0
    const time = Math.max(old?.time ?? 0, duration ? Math.min(end, duration) : end)
    result[path] = {
      time,
      duration,
      ratio: duration ? Math.min(1, time / duration) : (old?.ratio ?? 0),
      done: !!old?.done || (duration > 0 && end >= duration - SEGMENT_EPSILON),
      updatedAt: old?.updatedAt ?? 0,
    }
  }
  return result
}

/** Restore exact spans only: old snapshot IDs are matched against saved daily exercise scopes. */
export function restoreCompletionHistory(
  today: TodayPlan | null,
  date: string,
  paths: string[],
  snapshots: unknown,
  practiceScopes: unknown,
): TodayPlan | null {
  const known = new Set(paths),
    completed = completedBeforeDay(today, date)
  const scopes = new Map<string, Array<{ path: string; start: number; end: number }>>()
  if (Array.isArray(practiceScopes))
    for (const key of practiceScopes) {
      if (typeof key !== 'string') continue
      const match = /^daily:(\d{4}-\d{2}-\d{2}):(?:comprehensive-v1:)?(\[.*)$/.exec(key)
      if (!match || !validDate(match[1]) || match[1] >= date) continue
      try {
        const raw: unknown = JSON.parse(match[2]!)
        if (!Array.isArray(raw)) continue
        const entries = scopes.get(match[1]) ?? []
        for (const span of raw)
          if (
            Array.isArray(span) &&
            typeof span[0] === 'string' &&
            known.has(span[0]) &&
            typeof span[1] === 'number' &&
            Number.isFinite(span[1]) &&
            span[1] >= 0 &&
            typeof span[2] === 'number' &&
            Number.isFinite(span[2]) &&
            span[2] > span[1]
          ) {
            entries.push({ path: span[0], start: span[1], end: span[2] })
          }
        scopes.set(match[1], entries)
      } catch {
        /* A damaged or unrelated exercise key is not evidence of completion. */
      }
    }
  if (isRecord(snapshots))
    for (const [day, snapshot] of Object.entries(snapshots)) {
      if (
        !validDate(day) ||
        day >= date ||
        !isRecord(snapshot) ||
        snapshot.date !== day ||
        !Array.isArray(snapshot.tasks)
      )
        continue
      for (const task of snapshot.tasks) {
        if (!isRecord(task) || task.done !== true || !['lesson', 'review'].includes(String(task.kind))) continue
        let path: string | undefined, end: number | undefined
        if (
          typeof task.path === 'string' &&
          known.has(task.path) &&
          typeof task.start === 'number' &&
          task.start >= 0 &&
          typeof task.end === 'number' &&
          Number.isFinite(task.end) &&
          task.end > task.start
        ) {
          path = task.path
          end = task.end
        } else if (typeof task.id === 'string' && task.id.startsWith(`${day}:${task.kind}:`)) {
          const value = task.id.slice(`${day}:${task.kind}:`.length),
            split = value.lastIndexOf(':')
          const candidate = value.slice(0, split),
            start = Number(value.slice(split + 1))
          if (split < 0 || !known.has(candidate) || !Number.isFinite(start) || start < 0) continue
          const matches = (scopes.get(day) ?? []).filter(
            (span) => span.path === candidate && Math.abs(span.start - start) < 0.000001,
          )
          if (matches.length) {
            path = candidate
            end = Math.max(...matches.map((span) => span.end))
          }
        }
        if (path && end !== undefined) completed[path] = Math.max(completed[path] ?? 0, end)
      }
    }
  for (const path of Object.keys(completed)) if (!known.has(path)) delete completed[path]
  if (!Object.keys(completed).length) return today
  return {
    ...(today?.date === date ? today : { date, minutes: 0, override: null, items: [] }),
    completedBeforeToday: completed,
  }
}

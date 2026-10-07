import { daySnapshot } from './dailyPlan.ts'
import type { HomeCourse } from './learningHome.ts'
import type { databaseRequest } from './database'

const saved = new WeakMap<HomeCourse, string>()
export async function saveHomeSnapshots(
  courses: HomeCourse[],
  date: string,
  request: typeof databaseRequest,
  cancelled = () => false,
) {
  const results = await Promise.allSettled(
    courses
      .filter((c) => c.context?.plan)
      .map(async (entry) => {
        if (cancelled() || saved.get(entry) === date) return
        const snapshot = daySnapshot(entry.context!, date)
        snapshot.initialMinutes = entry.snapshots[date]?.initialMinutes ?? snapshot.plannedMinutes
        const previous = entry.snapshots[date]
        if (
          !previous ||
          JSON.stringify({ ...previous, capturedAt: 0 }) !== JSON.stringify({ ...snapshot, capturedAt: 0 })
        ) {
          await request('day-snapshots', { method: 'POST', body: { courseId: entry.course.id, snapshot } })
          if (cancelled()) return
          entry.snapshots[date] = snapshot
        }
        saved.set(entry, date)
      }),
  )
  if (results.some((result) => result.status === 'rejected')) throw Error('部分每日计划保存失败，请重试。')
}

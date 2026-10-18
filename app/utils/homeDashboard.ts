import type { HomeCourse } from './learningHome'
import { formatMinutes, validDate } from './studyProgram.ts'
import { localDayKey } from './learningFeedback.ts'

export function formatHomeDuration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return value > 0 && value < 60 ? `${value} 秒` : formatMinutes(Math.floor(value / 60))
}

export function totalCourseStudyTime(courses: HomeCourse[], today = localDayKey()) {
  let videoSeconds = 0,
    workSeconds = 0
  for (const entry of courses) {
    if (!entry.context || entry.error) continue
    for (const [date, day] of Object.entries(entry.days)) {
      if (validDate(date) && date <= today) videoSeconds += day.seconds
    }
    for (const record of entry.context.records.entries) {
      if (validDate(record.date) && record.date <= today) workSeconds += record.minutes * 60
    }
  }
  return { videoSeconds, workSeconds }
}

export function continueLearning(courses: HomeCourse[]) {
  return courses
    .filter(({ course, error }) => course.status === 'active' && course.videoCount > 0 && !error)
    .flatMap(({ course, context, days }) => {
      if (!context) return []
      const progress = context.progress
      const done = Object.values(progress).filter((item) => item.done).length
      if (done >= course.videoCount) return []
      const recent = Object.entries(progress)
        .filter(([, item]) => item.time > 0 || item.ratio > 0 || item.done)
        .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      const studiedDays = Object.entries(days).filter(([date, day]) => day.seconds > 0 && validDate(date))
      if (!recent.length && !studiedDays.length) return []
      const lastStudiedAt = studiedDays.reduce(
        (latest, [date]) => Math.max(latest, new Date(`${date}T00:00:00`).getTime()),
        recent[0]?.[1].updatedAt ?? 0,
      )
      const paths = [
        ...new Set([
          ...(context?.plan?.lessons.map((lesson) => lesson.path) ?? []),
          ...Object.keys(context?.metadata ?? {}),
          ...Object.keys(progress),
        ]),
      ]
      const last = course.lastVideoPath
      const path =
        recent.find(([, item]) => !item.done)?.[0] ??
        (last && !progress[last]?.done && (!paths.length || paths.includes(last))
          ? last
          : paths.find((p) => !progress[p]?.done))
      return [
        {
          id: course.id,
          name: course.name,
          path,
          title:
            path
              ?.split('/')
              .at(-1)
              ?.replace(/\.[^.]+$/u, '') ?? '查看课程',
          done,
          total: course.videoCount,
          percent: Math.round((done / course.videoCount) * 100),
          lastStudiedAt,
          to: {
            path: `/courses/${encodeURIComponent(course.id)}${path ? '/player' : ''}`,
            query: path ? { lesson: path, autoplay: '1' } : {},
          },
        },
      ]
    })
    .sort((a, b) => b.lastStudiedAt - a.lastStudiedAt)
    .slice(0, 3)
}

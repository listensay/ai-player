import type { HomeCourse } from './learningHome'
import { addDays } from './studyProgram.ts'
import { calculateDay } from './dailyPlan.ts'

const icsEscape = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
export function foldCalendarLine(line: string) {
  const lines: string[] = []
  let part = '',
    length = 0
  for (const char of line) {
    const size = new TextEncoder().encode(char).length
    if (length + size > 75) {
      lines.push(part)
      part = ' '
      length = 1
    }
    part += char
    length += size
  }
  lines.push(part)
  return lines.join('\r\n')
}
export function lessonLink(courseId: string, path: string, seconds = 0) {
  const query = new URLSearchParams({ course: courseId, lesson: path, at: String(seconds) })
  return `aiplayer://lesson?${query}`
}
export function learningCalendar(courses: HomeCourse[], today: string, time: string, days: number, now = Date.now()) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isInteger(days) || days < 1 || days > 90)
    throw Error('日历时间范围无效。')
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Study Helper//Learning//ZH',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Study Helper 学习计划',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ]
  // Simulate progress in a copy so tomorrow advances instead of repeating today's lessons.
  const contexts = courses
    .filter((c) => c.course.status === 'active' && c.context?.plan)
    .map((c) => ({ c, context: JSON.parse(JSON.stringify(c.context)) as NonNullable<HomeCourse['context']> }))
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i)
    let cursor = new Date(`${date}T${time}:00`).getTime()
    for (const { c, context } of contexts) {
      const result = calculateDay(context, date)
      for (const item of result.today.items.filter((t) => !t.done)) {
        const duration = Math.max(60, item.seconds)
        const title = item.path.split('/').at(-1) ?? item.path
        lines.push(
          'BEGIN:VEVENT',
          `UID:${encodeURIComponent(c.course.id)}-${date}-${encodeURIComponent(item.id)}@aiplayer`,
          `DTSTAMP:${stamp(new Date(now))}`,
          `DTSTART:${stamp(new Date(cursor))}`,
          `DTEND:${stamp(new Date(cursor + duration * 1000))}`,
          `SUMMARY:${icsEscape(`${c.course.name} · ${title}`)}`,
          `DESCRIPTION:${icsEscape(`预估 ${Math.ceil(duration / 60)} 分钟\n${lessonLink(c.course.id, item.path, item.start)}`)}`,
          `URL:${lessonLink(c.course.id, item.path, item.start)}`,
          'END:VEVENT',
        )
        cursor += duration * 1000
      }
      for (const work of result.work.filter((w) => !w.done && w.targetMinutes > 0)) {
        lines.push(
          'BEGIN:VEVENT',
          `UID:${encodeURIComponent(c.course.id)}-${date}-${encodeURIComponent(work.id)}@aiplayer`,
          `DTSTAMP:${stamp(new Date(now))}`,
          `DTSTART:${stamp(new Date(cursor))}`,
          `DTEND:${stamp(new Date(cursor + work.targetMinutes * 60000))}`,
          `SUMMARY:${icsEscape(`${c.course.name} · ${work.title}`)}`,
          `DESCRIPTION:${icsEscape(work.instructions)}`,
          'END:VEVENT',
        )
        cursor += work.targetMinutes * 60000
      }
      context.today = { ...result.today, items: result.today.items.map((t) => ({ ...t, done: true })) }
      context.today.completedBeforeToday = { ...context.today.completedBeforeToday }
      for (const item of result.today.items)
        if (item.kind !== 'question')
          context.today.completedBeforeToday[item.path] = Math.max(
            context.today.completedBeforeToday[item.path] ?? 0,
            item.end,
          )
      context.records.entries.push(...result.work.map((w) => ({ ...w, done: true })))
    }
  }
  return [...lines, 'END:VCALENDAR'].map(foldCalendarLine).join('\r\n') + '\r\n'
}

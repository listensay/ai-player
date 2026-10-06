import type { LearningManagementData, LearningSources, FlowCheckIn } from '../types/learningManagement'
import type { LearningPlan, StudyBudget } from '../types/guide'
import type { HomeCourse } from './learningHome'
import {
  addDays,
  budgetForDay,
  budgetTotal,
  parseProgram,
  programDay,
  programDate,
  stageForDay,
} from './studyProgram.ts'
import { calculateDayBudget, calculateDay } from './dailyPlan.ts'
import { estimateDuration } from './guide.ts'
import { localDayKey } from './learningFeedback.ts'

export function planHealth(course: HomeCourse, today: string) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 7)).flatMap((date) => {
    const snapshot = course.snapshots[date]
    if (!snapshot || snapshot.initialMinutes <= 0) return []
    const actual =
      (course.days[date]?.seconds ?? 0) / 60 +
      (course.context?.records.entries.filter((e) => e.date === date).reduce((n, e) => n + e.minutes, 0) ?? 0)
    const completion = snapshot.tasks.length ? snapshot.tasks.filter((t) => t.done).length / snapshot.tasks.length : 0
    return [
      {
        date,
        budget: snapshot.initialMinutes,
        actual,
        ratio: Math.max(actual / snapshot.initialMinutes, completion),
        backlog: snapshot.tasks.filter((t) => !t.done).length,
      },
    ]
  })
  const recent = days.slice(-3)
  const overloaded = recent.length === 3 && recent.every((d) => d.ratio < 0.6)
  const average = days.length ? Math.round(days.reduce((n, d) => n + d.actual, 0) / days.length) : 0
  const budget = days.length ? Math.round(days.reduce((n, d) => n + d.budget, 0) / days.length) : 0
  const backlogIds = new Set(
    Object.values(course.snapshots)
      .filter((s) => s.date < today)
      .flatMap((s) =>
        s.tasks
          .filter(
            (t) =>
              !t.done &&
              !(t.path && course.context?.progress[t.path]?.done) &&
              !course.context?.records.entries.some((e) => e.id === t.id && e.done),
          )
          .map((t) => t.id),
      ),
  )
  return {
    days,
    average,
    budget,
    overloaded: overloaded || backlogIds.size >= 8,
    recommended: Math.max(10, Math.min(budget || 30, Math.round(average / 5) * 5 || 15)),
    backlog: backlogIds.size,
  }
}
function scaleBudget(budget: StudyBudget, limit: number): StudyBudget {
  const total = budgetTotal(budget)
  if (total <= limit) return { ...budget }
  const keys = ['video', 'code', 'project', 'recap'] as const
  const next = {
    video: Math.min(budget.video, 5),
    code: Math.min(budget.code, 1),
    project: Math.min(budget.project, 1),
    recap: Math.min(budget.recap, 1),
  }
  const available = Math.max(0, limit - budgetTotal(next)),
    rest = total - budgetTotal(next)
  const shares: StudyBudget = { video: 0, code: 0, project: 0, recap: 0 }
  for (const key of keys) shares[key] = (available * (budget[key] - next[key])) / Math.max(1, rest)
  for (const key of keys) next[key] += Math.floor(shares[key])
  for (const key of [...keys].sort((a, b) => (shares[b] % 1) - (shares[a] % 1))) {
    if (budgetTotal(next) >= limit) break
    if (next[key] < budget[key]) next[key]++
  }
  return next
}
/** Future date overrides avoid rewriting historical budgets or completed work. */
export function adaptivePlan(
  course: HomeCourse,
  today: string,
  limit: number,
  strategy: 'lighter' | 'weekend' = 'lighter',
) {
  const context = course.context
  if (!context?.plan?.program) throw Error('请先设置完整学习计划。')
  if (!Number.isInteger(limit) || limit < 10 || limit > 1440) throw Error('每日时间应为 10–1440 分钟。')
  const plan: LearningPlan = JSON.parse(JSON.stringify(context.plan))
  const program = plan.program!
  if (
    program.calendar?.pause &&
    program.calendar.pause.from <= today &&
    (program.calendar.pause.until === null || program.calendar.pause.until > today)
  )
    throw Error('请先恢复暂停的计划。')
  const oldEnd = programDate(program, program.days)
  const first = Math.max(1, programDay(program, addDays(today, 1)))
  const originalDays = program.days
  program.calendar ??= { weekdays: [1, 2, 3, 4, 5, 6, 7], overrides: {} }
  if (!program.calendar.weekdays.length) throw Error('请先选择学习日。')
  const estimatedDuration = estimateDuration(
    Object.fromEntries(Object.entries(context.metadata).map(([path, m]) => [path, m.duration])),
  )
  const remainingSeconds = plan.lessons
    .filter(
      (l) =>
        l.status !== 'skipped' &&
        (l.status !== 'optional' || context.includeOptional) &&
        !context.progress[l.path]?.done,
    )
    .reduce(
      (n, l) =>
        n +
        Math.max(
          0,
          (context.metadata[l.path]?.duration ?? estimatedDuration) -
            (context.today?.completedBeforeToday?.[l.path] ?? 0),
        ),
      0,
    )
  const todayCapacity = Math.max(0, calculateDayBudget(context, today).video * 60 - (course.days[today]?.seconds ?? 0))
  let seconds = Math.max(0, remainingSeconds - todayCapacity),
    endDay = originalDays
  const workKinds = ['code', 'project', 'recap'] as const
  const remainingWork = { code: 0, project: 0, recap: 0 }
  for (let day = first; day <= originalDays; day++) {
    const budget = budgetForDay(program, stageForDay(plan.modules, day)?.practice, day)
    for (const kind of workKinds) remainingWork[kind] += budget[kind]
  }
  for (let day = first; day <= 1095; day++) {
    if (day > originalDays && seconds <= 0 && workKinds.every((k) => remainingWork[k] <= 0)) break
    const date = programDate(program, day)
    // Temporarily extend to evaluate a legitimate future weekday's budget.
    program.days = Math.max(program.days, day)
    let budget = budgetForDay(program, stageForDay(plan.modules, Math.min(day, originalDays))?.practice, day)
    const weekday = new Date(date).getUTCDay()
    if (
      strategy === 'weekend' &&
      (weekday === 0 || weekday === 6) &&
      !program.calendar.overrides[date] &&
      !program.calendar.weekdays.includes(weekday || 7) &&
      !(
        program.calendar.pause &&
        date >= program.calendar.pause.from &&
        (program.calendar.pause.until === null || date < program.calendar.pause.until)
      )
    )
      budget = { ...program.budget }
    const cap =
      strategy === 'weekend' && (weekday === 0 || weekday === 6) ? Math.min(1440, Math.round(limit * 1.5)) : limit
    // Reassign the remaining allowance when a category is finished, instead of extending around empty video slots.
    budget = { ...budget }
    if (seconds <= 0) budget.video = 0
    for (const kind of workKinds) if (remainingWork[kind] <= 0) budget[kind] = 0
    const next = scaleBudget(budget, cap)
    program.calendar.overrides[date] = next
    seconds -= next.video * 60
    for (const kind of workKinds) remainingWork[kind] -= next[kind]
    endDay = Math.max(endDay, day)
  }
  if (seconds > 0 || workKinds.some((k) => remainingWork[k] > 0))
    throw Error('当前学习日无法安排完课程与实践，请增加每日时间。')
  const shifted = endDay - originalDays
  program.days = endDay
  // Keep finished stages untouched; spread unfinished stage boundaries over the new period.
  const current = Math.max(1, programDay(program, today))
  const span = Math.max(1, originalDays - current + 1)
  for (const m of plan.modules)
    if (m.practice && m.practice.endDay >= current) {
      if (m.practice.startDay > current)
        m.practice.startDay += Math.round((shifted * (m.practice.startDay - current)) / span)
      m.practice.endDay += Math.round((shifted * (m.practice.endDay - current + 1)) / span)
    }
  plan.program = parseProgram(program)
  return { plan, oldEnd, newEnd: programDate(program, endDay), shifted, limit }
}

export function flowInsights(flows: FlowCheckIn[], courseId = '') {
  const selected = flows.filter((f) => !courseId || f.courseId === courseId)
  const groups = Array.from({ length: 24 }, (_, hour) => {
    const rows = selected.filter((f) => f.hour === hour)
    return {
      hour,
      count: rows.length,
      good: rows.filter((f) => f.mood === 'deep' || f.mood === 'steady').length,
      hard: rows.filter((f) => f.mood === 'struggling' || f.mood === 'tired').length,
    }
  }).filter((g) => g.count)
  const best = groups.filter((g) => g.count >= 2).sort((a, b) => b.good / b.count - a.good / a.count)[0]
  const hard = groups
    .filter((g) => g.count >= 2 && g.hard / g.count >= 0.5)
    .sort((a, b) => b.hard / b.count - a.hard / a.count)[0]
  return { groups, best: best && best.good > best.hard ? best : undefined, hard }
}
export function graduationReport(
  course: HomeCourse,
  data: LearningManagementData,
  sources: LearningSources,
  today: string,
) {
  const context = course.context
  const lessons = context?.plan?.lessons.filter((l) => l.status === 'required') ?? []
  const requiredWorks = data.contracts.filter((c) => c.courseId === course.course.id)
  const works = data.works.filter((w) => w.courseId === course.course.id && w.acceptedAt !== null)
  const graduated =
    lessons.length > 0 &&
    lessons.every((l) => context?.progress[l.path]?.done) &&
    requiredWorks.every((c) => works.some((w) => w.moduleId === c.moduleId)) &&
    (context?.plan?.modules.every((m) =>
      (m.practice?.checks ?? []).every((c) => context.records.checks[JSON.stringify([m.id, c.id])]?.passed),
    ) ??
      false)
  const minutes = Math.round(
    Object.values(course.days).reduce((n, d) => n + d.seconds / 60, 0) +
      (context?.records.entries.reduce((n, e) => n + e.minutes, 0) ?? 0),
  )
  const code = sources.practices.filter(
    (p) => p.courseId === course.course.id && p.record.question.kind === 'code' && p.record.attempts.length,
  )
  const passed = code.filter((p) => p.record.attempts.at(-1)?.feedback.result === 'solid').length
  const cards = data.cards.filter((c) => c.courseId === course.course.id)
  const mastered = cards.filter((c) => c.recall === 'remembered').length
  const knowledge = [...new Set(cards.flatMap((c) => c.concepts))]
  const markdown = `# ${graduated ? '结课证书' : '学习成果报告'}\n\n${course.course.name}\n${today}\n\n## 学习投入\n累计 ${minutes} 分钟 · 已完成 ${lessons.filter((l) => context?.progress[l.path]?.done).length} / ${lessons.length} 必修课节\n代码题通过率：${code.length ? `${Math.round((passed / code.length) * 100)}%` : '暂无记录'}\n\n## 实践作品\n${works.map((w) => `- ${w.title}\n  ${w.location || w.description}`).join('\n') || '暂无验收作品'}\n\n## 知识掌握\n已牢记 ${mastered} / ${cards.length} 张复习卡\n${knowledge.map((k) => `- ${k} · ${cards.filter((c) => c.concepts.includes(k) && c.recall === 'remembered').length}/${cards.filter((c) => c.concepts.includes(k)).length}`).join('\n') || '暂无复习记录'}\n\n## 学习契约\n${requiredWorks.map((c) => `- ${c.goal} · 每日 ${c.minutes} 分钟 · 目标 ${c.deadline}`).join('\n') || '尚未签订'}\n`
  return { graduated, markdown }
}
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
    'PRODID:-//AI Player//Learning//ZH',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Playbo 学习计划',
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
export function knowledgeDocument(course: HomeCourse, path: string, sources: LearningSources) {
  const note = sources.notes.find((n) => n.courseId === course.course.id && n.path === path)
  const summary = sources.summaries.find((s) => s.courseId === course.course.id && s.path === path)
  const practices = sources.practices.filter(
    (p) => p.courseId === course.course.id && (p.record.path === path || p.record.sources.some((s) => s.path === path)),
  )
  const header = `---\naiplayer_course: ${JSON.stringify(course.course.id)}\naiplayer_lesson: ${JSON.stringify(path)}\ntitle: ${JSON.stringify(path.split('/').at(-1))}\ncourse: ${JSON.stringify(course.course.name)}\nplayer: ${JSON.stringify(lessonLink(course.course.id, path))}\n---\n`
  const prefix = `${header}\n# ${path.split('/').at(-1)}\n\n[返回播放器](${lessonLink(course.course.id, path)})\n\n## AI 知识点\n${summary ? [summary.overview, ...summary.points.map((p) => `### ${p.title}\n${p.text}\n[回看片段](${lessonLink(course.course.id, path, p.start)})`)].join('\n\n') : '暂无总结'}\n\n## 课程笔记\n<!-- aiplayer:note:start -->\n`
  const suffix = `\n<!-- aiplayer:note:end -->\n\n## 练习记录\n${practices.map((p) => `### ${p.record.question.prompt}\n${p.record.question.referenceAnswer}\n\n${p.record.attempts.map((a) => `- ${localDayKey(new Date(a.at))} · ${a.feedback.result === 'solid' ? '已掌握' : '待复习'}\n  ${a.answer}`).join('\n')}`).join('\n\n') || '暂无练习'}\n`
  return {
    content: prefix + (note?.content ?? '') + suffix,
    note: note?.content ?? '',
    prefix,
    suffix,
    updatedAt: note?.updatedAt ?? null,
  }
}

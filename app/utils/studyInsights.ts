import type { FocusSession, StudyEvidence } from '../types/studyInsights'
import type { HomeCourse } from './learningHome'
import { isRecord } from './guide.ts'
import { localDayKey } from './learningFeedback.ts'
import { addDays, validDate } from './studyProgram.ts'

export function restoreFocusHistory(raw: unknown): FocusSession[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 5000) throw Error('专注历史格式异常。')
  return raw.map((s) => {
    if (
      !isRecord(s) ||
      !Number.isSafeInteger(s.startedAt) ||
      Number(s.startedAt) < 0 ||
      !validDate(s.date) ||
      !Number.isInteger(s.startHour) ||
      Number(s.startHour) < 0 ||
      Number(s.startHour) > 23 ||
      !Number.isSafeInteger(s.interruptions) ||
      Number(s.interruptions) < 0 ||
      !['active', 'completed', 'abandoned'].includes(String(s.outcome)) ||
      (s.outcome === 'active'
        ? s.endedAt !== null
        : !Number.isSafeInteger(s.endedAt) || Number(s.endedAt) < Number(s.startedAt))
    )
      throw Error('专注历史格式异常。')
    return { ...s } as unknown as FocusSession
  })
}
export function restoreStudyEvidence(raw: unknown): StudyEvidence {
  if (!isRecord(raw) || !Array.isArray(raw.notes) || !Array.isArray(raw.practices)) throw Error('学习证据格式异常。')
  const timestamp = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  if (
    raw.notes.some(
      (n) => !isRecord(n) || typeof n.courseId !== 'string' || !timestamp(n.characters) || !timestamp(n.updatedAt),
    ) ||
    raw.practices.some(
      (p) =>
        !isRecord(p) ||
        typeof p.courseId !== 'string' ||
        typeof p.id !== 'string' ||
        (p.solidAt !== null && !timestamp(p.solidAt)),
    )
  )
    throw Error('学习证据格式异常。')
  return raw as unknown as StudyEvidence
}
export function digestPeriod(kind: 'week' | 'month', offset: 0 | -1, today = localDayKey()) {
  const date = new Date(`${today}T12:00:00`)
  if (kind === 'week') {
    const start = addDays(today, 1 - (date.getDay() || 7) + offset * 7)
    return { start, end: offset === 0 ? today : addDays(start, 6), label: offset === 0 ? '本周' : '上周' }
  }
  const start = localDayKey(new Date(date.getFullYear(), date.getMonth() + offset, 1))
  return {
    start,
    end: offset === 0 ? today : localDayKey(new Date(date.getFullYear(), date.getMonth(), 0)),
    label: offset === 0 ? '本月' : '上月',
  }
}
export function buildStudyInsights(
  courses: HomeCourse[],
  evidence: StudyEvidence,
  history: FocusSession[],
  period: { start: string; end: string; label: string },
  today = localDayKey(),
) {
  const within = (day: string) => validDate(day) && day >= period.start && day <= period.end
  const atPeriod = (at: number) => within(localDayKey(new Date(at)))
  const checkDays = new Set<string>(),
    activeDays = new Set<string>()
  const checkHours = Array.from({ length: 24 }, () => 0)
  let totalSeconds = 0,
    seconds = 0,
    completedCourses = 0,
    stageTasks = 0
  const courseRows: Array<{ name: string; minutes: number; watchCompleted: boolean }> = []
  const mastered: string[] = [],
    needsReview: string[] = []
  for (const entry of courses) {
    if (!entry.context || entry.error) continue
    let courseSeconds = 0
    for (const [day, record] of Object.entries(entry.days)) {
      if (!validDate(day) || day > today) continue
      totalSeconds += record.seconds
      if (record.seconds > 0) activeDays.add(day)
      if (within(day)) courseSeconds += record.seconds
      if (
        typeof record.checkedAt === 'number' &&
        Number.isFinite(record.checkedAt) &&
        record.checkedAt >= 0 &&
        record.targetSeconds > 0 &&
        record.seconds >= record.targetSeconds
      ) {
        checkDays.add(day)
        if (within(day)) checkHours[new Date(record.checkedAt).getHours()]!++
      }
    }
    for (const record of entry.context.records.entries) {
      if (!validDate(record.date) || record.date > today) continue
      totalSeconds += record.minutes * 60
      if (record.minutes > 0) activeDays.add(record.date)
      if (within(record.date)) courseSeconds += record.minutes * 60
      if (record.done) stageTasks++
    }
    seconds += courseSeconds
    const done = Object.values(entry.context.progress).filter((p) => p.done).length
    const watchCompleted = entry.course.videoCount > 0 && done >= entry.course.videoCount
    if (watchCompleted) completedCourses++
    if (courseSeconds > 0)
      courseRows.push({ name: entry.course.name, minutes: Math.round(courseSeconds / 60), watchCompleted })
    for (const m of Object.values(entry.context.mastery)) {
      if (m.level === 'mastered' && atPeriod(m.updatedAt)) mastered.push(m.concept)
      if (m.level === 'needs-review' && m.updatedAt <= Date.now()) needsReview.push(m.concept)
    }
  }
  const checked = [...checkDays].filter(within).length
  let bestStreak = 0,
    streak = 0,
    prior = ''
  for (const day of [...checkDays].sort()) {
    streak = prior && addDays(prior, 1) === day ? streak + 1 : 1
    bestStreak = Math.max(bestStreak, streak)
    prior = day
  }
  const knownCourses = new Set(courses.filter((c) => !c.error && c.context).map((c) => c.course.id))
  const notes = evidence.notes.filter((n) => knownCourses.has(n.courseId))
  const noteCharacters = notes.reduce((sum, n) => sum + n.characters, 0)
  const updatedCharacters = notes.filter((n) => atPeriod(n.updatedAt)).reduce((sum, n) => sum + n.characters, 0)
  const solid = new Map(
    evidence.practices
      .filter((p) => knownCourses.has(p.courseId) && p.solidAt !== null && p.solidAt <= Date.now())
      .map((p) => [JSON.stringify([p.courseId, p.id]), p]),
  )
  const solved = [...solid.values()].filter((p) => atPeriod(p.solidAt!)).length
  const sessions = history.filter((s) => within(s.date))
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const group = sessions.filter((s) => s.startHour === hour && s.outcome !== 'active')
    return {
      hour,
      samples: group.length,
      completed: group.filter((s) => s.outcome === 'completed').length,
      interrupted: group.filter((s) => s.interruptions > 0 || s.outcome === 'abandoned').length,
      checkIns: checkHours[hour]!,
    }
  })
  // At least five terminal sessions on three separate days; no causal/productivity claim.
  const best =
    hours
      .filter(
        (h) =>
          h.samples >= 5 &&
          h.completed > 0 &&
          h.interrupted < h.samples &&
          new Set(sessions.filter((s) => s.startHour === h.hour && s.outcome !== 'active').map((s) => s.date)).size >=
            3,
      )
      .sort((a, b) => a.interrupted / a.samples - b.interrupted / b.samples || b.completed - a.completed)[0] ?? null
  const nightFocuses = history.filter((s) => s.outcome === 'completed' && (s.startHour >= 21 || s.startHour < 5)).length
  const badges = [
    { id: 'streak', name: '连续打卡 21 天', value: bestStreak, target: 21 },
    { id: 'course', name: '首门课通关', value: completedCourses, target: 1 },
    { id: 'night', name: '夜猫子专注', value: nightFocuses, target: 1 },
    { id: 'notes', name: '笔记字数破万', value: noteCharacters, target: 10000 },
    { id: 'practice', name: '百题斩', value: solid.size, target: 100 },
  ].map((b) => ({ ...b, unlocked: b.value >= b.target }))
  const points = checkDays.size * 10 + stageTasks * 5
  const level = points >= 300 ? 3 : points >= 70 ? 2 : 1
  return {
    period,
    seconds,
    checked,
    courseRows,
    mastered: [...new Set(mastered)],
    needsReview: [...new Set(needsReview)].slice(0, 20),
    updatedCharacters,
    solved,
    focusCompleted: sessions.filter((s) => s.outcome === 'completed').length,
    hours,
    best,
    badges,
    growth: {
      days: activeDays.size,
      totalSeconds,
      points,
      level,
      label: ['初级陪伴', '进阶陪伴', '高级陪伴'][level - 1]!,
      next: level === 1 ? 70 : level === 2 ? 300 : null,
    },
    incomplete: courses.some((c) => !!c.error),
  }
}
export type StudyInsights = ReturnType<typeof buildStudyInsights>
export function digestMarkdown(data: StudyInsights, reflection = '') {
  return `# Playbo 学习${data.period.label.includes('周') ? '周报' : '月报'}\n\n> ${data.period.start} — ${data.period.end} · ${data.period.label}\n\n## 学习概况\n\n- 学习投入：${(data.seconds / 3600).toFixed(1)} 小时\n- 达标打卡：${data.checked} 天\n- 完成专注：${data.focusCompleted} 次\n- 标记已掌握：${data.mastered.length} 个知识点\n- 练习达标：${data.solved} 道题\n- 笔记累计字符：${data.updatedCharacters}\n\n## 课程学习记录\n\n${data.courseRows.map((c) => `- ${c.name.replace(/[\r\n]/g, ' ')}：${c.minutes} 分钟${c.watchCompleted ? '（已学完）' : ''}`).join('\n') || '本期暂无学习记录。'}\n\n## 复盘与建议\n\n${reflection || (data.needsReview.length ? `待强化知识点：${data.needsReview.join('、')}。` : '本期暂无待强化知识点。')}\n${data.incomplete ? '\n> 提示：部分课程读取失败，统计可能不完整。\n' : ''}`
}

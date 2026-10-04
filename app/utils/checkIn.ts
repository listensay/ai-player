import type { PlaybackSample } from '../types/practice'
import type { StudyDay } from '../types/checkIn'
import type { TodayPlan, WorkEntry } from '../types/guide'
import { isRecord } from './guide.ts'
import { localDayKey } from './learningFeedback.ts'
import { dailyPracticeItems } from './dailyPracticeScope.ts'

/** 按当天原安排计算任务进度；倍速不折损完成量，提前学习不增加打卡要求。 */
export function studyPlanProgress(
  today: TodayPlan | null,
  date: string,
  targetSeconds: number,
  work: WorkEntry[] = [],
) {
  if (today?.date !== date || targetSeconds <= 0) return null
  const items = dailyPracticeItems(today, date)
  const entries = work.filter((entry) => entry.date === date && entry.targetMinutes > 0)
  const videoTarget = Math.min(targetSeconds, Math.max(0, today.minutes * 60))
  const workTarget = targetSeconds - videoTarget
  if (!(videoTarget > 0 && items.length) && !(workTarget > 0 && entries.length)) return null
  const videoTotal = items.reduce((sum, item) => sum + item.seconds, 0)
  const videoDone = items.filter((item) => item.done).reduce((sum, item) => sum + item.seconds, 0)
  const workTotal = entries.reduce((sum, entry) => sum + entry.targetMinutes, 0)
  const workDone = entries.filter((entry) => entry.done).reduce((sum, entry) => sum + entry.targetMinutes, 0)
  const videoRatio = videoTotal > 0 ? videoDone / videoTotal : 0
  const workRatio = workTotal > 0 ? workDone / workTotal : 0
  return Math.min(1, (videoTarget * videoRatio + workTarget * workRatio) / targetSeconds)
}

/** 用媒体推进确认有效播放，再按真实经过的时间计时，排除跳转与缓冲。 */
export function effectivePlaybackSeconds(previous: PlaybackSample | null, current: PlaybackSample): number {
  if (!previous || !previous.playing || previous.seeking || current.seeking) return 0
  if (
    ![previous.at, current.at, previous.seconds, current.seconds, previous.rate].every(Number.isFinite) ||
    previous.rate <= 0
  )
    return 0
  const elapsed = (current.at - previous.at) / 1000
  const mediaDelta = current.seconds - previous.seconds
  if (elapsed <= 0 || mediaDelta <= 0 || mediaDelta > elapsed * previous.rate + 0.75) return 0
  return Math.min(elapsed, mediaDelta / previous.rate)
}

/** 按本地午夜切分短播放区间，避免把跨天时间全部算到某一天。 */
export function splitStudySeconds(end: number, seconds: number): Array<{ date: string; seconds: number }> {
  if (!Number.isFinite(end) || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) return []
  const result: Array<{ date: string; seconds: number }> = []
  let start = end - seconds * 1000
  while (start < end) {
    const day = new Date(start)
    const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
    const boundary = Math.min(midnight, end)
    if (!(boundary > start)) break
    result.push({ date: localDayKey(day), seconds: (boundary - start) / 1000 })
    start = boundary
  }
  return result
}

/** extraSeconds 为当天记录的实践时间（编码、项目、复习），与有效看课时长合计判断是否达标。 */
export function setStudyTarget(day: StudyDay, minutes: number, now: number, extraSeconds = 0, planComplete = false) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return
  if (day.checkedAt === null) day.targetSeconds = minutes * 60
  checkStudyDay(day, now, extraSeconds, planComplete)
}
export function checkStudyDay(day: StudyDay, now: number, extraSeconds = 0, planComplete = false) {
  if (
    day.checkedAt === null &&
    day.targetSeconds > 0 &&
    (planComplete || day.seconds + extraSeconds >= day.targetSeconds)
  )
    day.checkedAt = now
}

export function validDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  return year >= 2000 && year <= 9999 && localDayKey(new Date(year, month - 1, day)) === value
}

export function restoreStudyDays(raw: unknown): Record<string, StudyDay> {
  const days: Record<string, StudyDay> = {}
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.days)) return days
  for (const value of raw.days.slice(-5000)) {
    if (
      !isRecord(value) ||
      !validDayKey(value.date) ||
      typeof value.seconds !== 'number' ||
      !Number.isFinite(value.seconds) ||
      value.seconds < 0 ||
      value.seconds > 86400 ||
      typeof value.targetSeconds !== 'number' ||
      !Number.isInteger(value.targetSeconds) ||
      value.targetSeconds < 300 ||
      value.targetSeconds > 86400 ||
      (value.checkedAt !== null &&
        (typeof value.checkedAt !== 'number' || !Number.isFinite(value.checkedAt) || value.checkedAt < 0))
    )
      continue
    days[value.date] = {
      date: value.date,
      seconds: value.seconds,
      targetSeconds: value.targetSeconds,
      // 完成安排或实践投入也能达标，不能仅凭观看时长撤销已保存的打卡。
      checkedAt: value.checkedAt as number | null,
    }
  }
  return days
}

export function calendarDays(year: number, month: number) {
  const start = new Date(year, month, 1)
  const offset = (start.getDay() + 6) % 7
  const count = new Date(year, month + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, i) => {
    const date = new Date(year, month, i - offset + 1)
    return { date: localDayKey(date), day: date.getDate(), currentMonth: date.getMonth() === month }
  })
  return cells
}

/** 从计划开始当天起标记未达标日期；未来、计划外和零目标休息日不标记。 */
export function isMissedStudyDay(options: {
  date: string
  today: string
  startDate?: string | null
  endDate?: string | null
  seconds: number
  targetSeconds: number
  checkedAt?: number | null
}) {
  return (
    !!options.startDate &&
    options.date >= options.startDate &&
    options.date <= options.today &&
    (!options.endDate || options.date <= options.endDate) &&
    options.checkedAt == null &&
    options.targetSeconds > 0 &&
    options.seconds < options.targetSeconds
  )
}

export function studyStreak(days: Record<string, StudyDay>, today: string): number {
  if (!validDayKey(today)) return 0
  const [year, month, day] = today.split('-').map(Number) as [number, number, number]
  const cursor = new Date(year, month - 1, day)
  if (days[today]?.checkedAt == null) cursor.setDate(cursor.getDate() - 1)
  let count = 0
  while (days[localDayKey(cursor)]?.checkedAt != null) {
    count++
    cursor.setDate(cursor.getDate() - 1)
  }
  return count
}

export function formatStudyClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds)),
    hours = Math.floor(total / 3600),
    minutes = Math.floor((total % 3600) / 60)
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function formatStudyHours(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 分钟'
  const totalMinutes = Math.floor(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) return `${hours} 小时 ${minutes} 分钟`
  if (hours > 0) return `${hours} 小时`
  return `${minutes} 分钟`
}

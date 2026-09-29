import type { MacReminderLink, MacReminderSnapshot, StudyReminder, StudyToolsData } from '../types/studyTools'
import { localDayKey } from './learningFeedback.ts'
import { validDate } from './studyProgram.ts'

export const emptyStudyTools = (): StudyToolsData => ({ version: 1, desktopNotifications: false, reminders: [] })
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const integer = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const date = (v: unknown) => typeof v === 'string' && validDate(v)
function uniqueIds(values: unknown, limit: number): values is Record<string, any>[] {
  return Array.isArray(values) && values.length <= limit && values.every(v => record(v) && text(v.id, 100))
    && new Set(values.map(v => v.id)).size === values.length
}

/** Invalid saved data must never silently become an empty, writable collection. */
export function parseStudyTools(raw: unknown): StudyToolsData {
  if (raw === null) return emptyStudyTools()
  if (!record(raw) || raw.version !== 1 || typeof raw.desktopNotifications !== 'boolean'
    || !uniqueIds(raw.reminders, 100)) throw new Error('学习管理记录格式异常，原始数据已保留。')
  for (const r of raw.reminders) {
    if (!text(r.title, 80) || typeof r.courseId !== 'string' || typeof r.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)
      || !Array.isArray(r.weekdays) || !r.weekdays.length || r.weekdays.some(d => !integer(d, 1, 7)) || new Set(r.weekdays).size !== r.weekdays.length
      || typeof r.enabled !== 'boolean' || typeof r.pending !== 'boolean' || (r.lastNotifiedDate !== '' && !date(r.lastNotifiedDate))
      || (r.snoozedUntil !== null && !integer(r.snoozedUntil, 0, 8.64e15))) throw new Error('提醒需要标题、有效时间和至少一个重复日。')
  }
  // Preserve legacy fields without letting retired features block reminder updates.
  return structuredClone(raw) as StudyToolsData
}

export function reminderDue(reminder: StudyReminder, now: Date): 'scheduled' | 'snoozed' | null {
  if (!reminder.enabled) return null
  if (reminder.snoozedUntil !== null) return now.getTime() >= reminder.snoozedUntil ? 'snoozed' : null
  const day = localDayKey(now), weekday = now.getDay() || 7
  const [hours, minutes] = reminder.time.split(':').map(Number)
  if (reminder.lastNotifiedDate === day || !reminder.weekdays.includes(weekday)
    || now.getHours() * 60 + now.getMinutes() < hours! * 60 + minutes!) return null
  return 'scheduled'
}

export function deliverReminder(reminder: StudyReminder, now: Date) {
  if (!reminderDue(reminder, now)) return false
  reminder.snoozedUntil = null
  // A snooze crossing midnight can also cover today's scheduled occurrence.
  if (reminderDue(reminder, now) === 'scheduled') reminder.lastNotifiedDate = localDayKey(now)
  reminder.pending = true
  return true
}

/** Keep delivery state that may have changed while the edit form was open. */
export function updateReminder(data: StudyToolsData, draft: StudyReminder) {
  const index = data.reminders.findIndex(r => r.id === draft.id)
  const existing = data.reminders[index]
  if (!existing) { data.reminders.push(draft); return }
  const sameSchedule = existing.time === draft.time && existing.courseId === draft.courseId
    && [...existing.weekdays].sort().join() === [...draft.weekdays].sort().join()
  data.reminders[index] = { ...draft, lastNotifiedDate: existing.lastNotifiedDate,
    pending: draft.enabled && sameSchedule && existing.pending,
    snoozedUntil: draft.enabled && sameSchedule ? existing.snoozedUntil : null }
}

export function macReminderSnapshot(reminder: StudyReminder, courseActive = true): MacReminderSnapshot {
  return { title: reminder.title, time: reminder.time, weekdays: [...reminder.weekdays].sort((a, b) => a - b),
    courseId: reminder.courseId, enabled: reminder.enabled && courseActive }
}

/** Delivery state is local only; passage of time and snoozing do not make a system export stale. */
export function macReminderStatus(reminder: StudyReminder, link: MacReminderLink | undefined, courseActive = true) {
  if (!link) return { label: '未添加', action: '添加到 Mac 提醒事项', pending: false }
  const current = macReminderSnapshot(reminder, courseActive), saved = link.snapshot
  const same = saved && current.title === saved.title && current.time === saved.time && current.courseId === saved.courseId
    && current.enabled === saved.enabled && current.weekdays.join() === [...saved.weekdays].sort((a, b) => a - b).join()
  if (same) return { label: current.enabled ? '已添加' : '已同步停用', action: current.enabled ? '更新 Mac 提醒' : '同步 Mac 提醒', pending: false }
  return { label: !current.enabled ? '停用待同步' : saved?.enabled === false ? '启用待同步' : '修改后待更新',
    action: !current.enabled ? '同步停用' : '同步更新', pending: true }
}

/** A course reminder follows that course; a general reminder follows any study today. */
export function studiedForReminder(reminder: Pick<StudyReminder, 'courseId'>, studied: Record<string, string>, date: string) {
  return reminder.courseId ? studied[reminder.courseId] === date : Object.values(studied).includes(date)
}

export function suppressStudiedReminder(reminder: StudyReminder, now: Date) {
  const date = localDayKey(now)
  const changed = reminder.pending || reminder.snoozedUntil !== null || reminder.lastNotifiedDate !== date
  reminder.pending = false
  reminder.snoozedUntil = null
  reminder.lastNotifiedDate = date
  return changed
}

export function hasStudyActivity(days: Record<string, { seconds: number }>, records: unknown, date: string) {
  if ((days[date]?.seconds ?? 0) > 0) return true
  return record(records) && Array.isArray(records.entries)
    && records.entries.some((e: unknown) => record(e) && e.date === date && typeof e.minutes === 'number' && e.minutes > 0)
}

import type { LearningManagementData } from '../types/learningManagement'
import { isRecord } from './guide.ts'

export function emptyLearningManagement(): LearningManagementData {
  return {
    version: 1,
    preferences: { calendarTime: '20:00', calendarDays: 30, calendarEnabled: false },
  }
}

export function parseLearningManagement(raw: unknown): LearningManagementData {
  if (raw == null) return emptyLearningManagement()
  if (!isRecord(raw) || raw.version !== 1) throw Error('学习日历记录版本无法读取。')
  const p = raw.preferences
  if (
    !isRecord(p) ||
    typeof p.calendarTime !== 'string' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.calendarTime) ||
    typeof p.calendarDays !== 'number' ||
    !Number.isInteger(p.calendarDays) ||
    p.calendarDays < 1 ||
    p.calendarDays > 90 ||
    typeof p.calendarEnabled !== 'boolean'
  )
    throw Error('学习日历设置无效。')
  return {
    version: 1,
    preferences: { calendarTime: p.calendarTime, calendarDays: p.calendarDays, calendarEnabled: p.calendarEnabled },
  }
}

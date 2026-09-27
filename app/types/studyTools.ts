export interface StudyReminder {
  id: string
  title: string
  courseId: string
  time: string
  weekdays: number[]
  enabled: boolean
  lastNotifiedDate: string
  snoozedUntil: number | null
  pending: boolean
}

export interface StudyToolsData {
  version: 1
  desktopNotifications: boolean
  reminders: StudyReminder[]
}

export interface MacReminderSnapshot {
  title: string
  time: string
  weekdays: number[]
  courseId: string
  enabled: boolean
}

export interface MacReminderLink {
  identifier: string
  calendar: string
  exportedAt: number
  snapshot?: MacReminderSnapshot | null
}

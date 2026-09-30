import { dbSaveGuide, dbSaveSetting } from '~/utils/dbClient'
import { databaseRequest } from '~/utils/database'
import type { StudyRecords } from '~/types/guide'
import type { daySnapshot } from '~/utils/dailyPlan'

/** Persistence owns debounce/deduplication; the guide owns scheduling and learning decisions. */
export function useGuidePersistence(options: {
  revision: () => number
  guide: () => Parameters<typeof dbSaveGuide>[0] | null
  records: () => { key: string; value: StudyRecords } | null
  day: () => { courseId: string; snapshot: ReturnType<typeof daySnapshot> } | null
  error: (message: string) => void
}) {
  let guideTimer: ReturnType<typeof setTimeout> | undefined
  let recordsTimer: ReturnType<typeof setTimeout> | undefined
  let lastSaved = '',
    lastRecords = '',
    lastSnapshot = ''
  let snapshotDirty = true
  function captureDay() {
    const data = options.day()
    if (!data) return
    const content = JSON.stringify({ courseId: data.courseId, snapshot: { ...data.snapshot, capturedAt: 0 } })
    snapshotDirty = false
    if (content === lastSnapshot) return
    lastSnapshot = content
    const revision = options.revision()
    void databaseRequest('day-snapshots', { method: 'POST', body: JSON.parse(JSON.stringify(data)) }).catch(() => {
      if (revision === options.revision() && lastSnapshot === content) {
        lastSnapshot = ''
        snapshotDirty = true
        options.error('每日计划记录保存失败，请重试。')
      }
    })
  }
  function saveRecords() {
    clearTimeout(recordsTimer)
    const data = options.records()
    if (!data) return false
    const serialized = JSON.stringify(data)
    if (serialized === lastRecords) return false
    lastRecords = serialized
    const revision = options.revision()
    const fail = () => {
      if (revision === options.revision() && lastRecords === serialized) {
        lastRecords = ''
        options.error('实践与计划调整记录保存失败，请重试。')
      }
    }
    const snapshot = JSON.parse(serialized) as typeof data
    void dbSaveSetting(snapshot.key, snapshot.value).then((saved) => {
      if (!saved) fail()
    }, fail)
    return true
  }
  function persistRecords() {
    if (saveRecords() || snapshotDirty) captureDay()
  }
  function persist() {
    clearTimeout(guideTimer)
    const recordsChanged = saveRecords()
    const data = options.guide()
    if (!data) {
      if (recordsChanged || snapshotDirty) captureDay()
      return
    }
    const serialized = JSON.stringify(data)
    if (serialized === lastSaved) {
      if (recordsChanged || snapshotDirty) captureDay()
      return
    }
    lastSaved = serialized
    const revision = options.revision()
    const fail = () => {
      if (revision === options.revision() && lastSaved === serialized) {
        lastSaved = ''
        options.error('导学数据保存失败，原有记录已保留。请重新打开课程后重试。')
      }
    }
    void dbSaveGuide(JSON.parse(serialized)).then((saved) => {
      if (!saved) fail()
    }, fail)
    captureDay()
  }
  function reset() {
    lastSaved = ''
    lastRecords = ''
    lastSnapshot = ''
    snapshotDirty = true
    clearTimeout(guideTimer)
    clearTimeout(recordsTimer)
  }
  function schedule() {
    clearTimeout(guideTimer)
    guideTimer = setTimeout(persist, 200)
  }
  function scheduleRecords() {
    clearTimeout(recordsTimer)
    recordsTimer = setTimeout(persistRecords, 300)
  }
  return { persist, persistRecords, captureDay, reset, schedule, scheduleRecords }
}

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
  let lastSaved = '', lastSnapshot = ''
  const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  function captureDay() {
    const data = options.day()
    if (!data) return
    const content = JSON.stringify({ ...data.snapshot, capturedAt: 0 })
    if (content === lastSnapshot) return
    lastSnapshot = content
    const revision = options.revision()
    void databaseRequest('day-snapshots', { method: 'POST', body: plain(data) }).catch(() => {
      if (revision === options.revision()) { lastSnapshot = ''; options.error('每日计划记录保存失败，请重试。') }
    })
  }
  function persistRecords() {
    clearTimeout(recordsTimer)
    const data = options.records()
    if (!data) return
    const revision = options.revision()
    void dbSaveSetting(data.key, plain(data.value)).then(saved => {
      if (!saved && revision === options.revision()) options.error('实践与计划调整记录保存失败，请重试。')
    })
    captureDay()
  }
  function persist() {
    clearTimeout(guideTimer)
    persistRecords()
    const data = options.guide()
    if (!data) return
    const serialized = JSON.stringify(data)
    if (serialized === lastSaved) return
    lastSaved = serialized
    const revision = options.revision()
    void dbSaveGuide(plain(data)).then(saved => {
      if (!saved && revision === options.revision()) {
        lastSaved = ''
        options.error('导学数据保存失败，原有记录已保留。请重新打开课程后重试。')
      }
    })
  }
  function reset() { lastSaved = ''; lastSnapshot = ''; clearTimeout(guideTimer); clearTimeout(recordsTimer) }
  function schedule() { clearTimeout(guideTimer); guideTimer = setTimeout(persist, 200) }
  function scheduleRecords() { clearTimeout(recordsTimer); recordsTimer = setTimeout(persistRecords, 300) }
  return { persist, persistRecords, captureDay, reset, schedule, scheduleRecords }
}

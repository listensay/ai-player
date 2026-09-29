import { computed, inject, onBeforeUnmount, onMounted, provide, reactive, toRaw } from 'vue'
import type { InjectionKey } from 'vue'
import { databaseRequest } from '~/utils/database'
import { desktopInvoke } from '~/utils/platform'
import { hasStudyActivity, studiedForReminder, suppressStudiedReminder, deliverReminder, emptyStudyTools, macReminderStatus, parseStudyTools, reminderDue } from '~/utils/studyTools'
import { localDayKey } from '~/utils/learningFeedback'
import { useCourseStore } from './useCourseStore'
import type { MacReminderLink, StudyReminder, StudyToolsData } from '~/types/studyTools'

const KEY: InjectionKey<ReturnType<typeof provideStudyTools>> = Symbol('study-tools')
export function provideStudyTools() {
  const state = reactive({ data: emptyStudyTools(), ready: false, loading: false, saving: 0, error: '', notice: '' })
  const mac = reactive({ available: false, ready: false, busy: false, error: '', notice: '', links: {} as Record<string, MacReminderLink> })
  let exporting: Promise<boolean> | undefined
  const store = useCourseStore()
  let queue: Promise<unknown> = Promise.resolve(), timer: ReturnType<typeof setInterval> | undefined, stopped = false, checking = false
  async function load() {
    if (state.loading || state.ready) return
    state.loading = true; state.error = ''
    try {
      const data = parseStudyTools(await databaseRequest('settings', { query: { key: 'study-tools' } }))
      if (stopped) return
      state.data = data; state.ready = true
      void checkReminders()
    } catch (error) { state.error = String(error) }
    finally { state.loading = false }
  }
  function mutate(change: (data: StudyToolsData) => void): Promise<boolean> {
    if (!state.ready || mac.busy) return Promise.resolve(false)
    state.saving++
    const task = queue.then(async () => {
      const next = structuredClone(toRaw(state.data))
      change(next)
      const valid = parseStudyTools(next)
      await databaseRequest('settings', { method: 'POST', body: { key: 'study-tools', value: valid } })
      state.data = valid; state.error = ''
      return true
    }).catch(error => { state.error = `保存失败：${String(error)}`; return false }).finally(() => { state.saving-- })
    queue = task
    return task
  }
  const studied = reactive<Record<string, string>>({})
  const activityLoaded = reactive<Record<string, string>>({})
  const clock = reactive({ date: localDayKey() })
  function markStudied(courseId: string, date: string) {
    if (!courseId || studied[courseId] === date) return
    studied[courseId] = date
    void checkReminders()
  }
  const hasStudied = (r: StudyReminder) => studiedForReminder(r, studied, clock.date)
  const activityReady = (r: StudyReminder) => r.courseId
    ? activityLoaded[r.courseId] === clock.date || hasStudied(r)
    : store.state.library.every(c => activityLoaded[c.id] === clock.date) || hasStudied(r)
  const courseActive = (id: string) => !id || store.state.library.some(c => c.id === id && c.status === 'active')
  const pending = computed(() => state.data.reminders.filter(r => r.enabled && r.pending && courseActive(r.courseId) && activityReady(r) && !hasStudied(r)))
  async function checkReminders() {
    if (checking || stopped || !state.ready || !store.state.libraryReady) return
    if (!state.data.reminders.some(r => r.enabled)) return
    checking = true
    clock.date = localDayKey()
    try {
      const ids = new Set(state.data.reminders.filter(r => r.enabled).flatMap(r => r.courseId ? [r.courseId] : store.state.library.map(c => c.id)))
      await Promise.all([...ids].filter(id => activityLoaded[id] !== clock.date).map(async id => {
        const [days, records] = await Promise.all([
          databaseRequest<Record<string, { seconds: number }>>('check-in', { query: { courseId: id } }),
          databaseRequest('settings', { query: { key: `study-records:${id}` } }),
        ])
        if (hasStudyActivity(days, records, clock.date)) studied[id] = clock.date
        activityLoaded[id] = clock.date
      }))
      if (stopped) return
      const now = new Date()
      if (localDayKey(now) !== clock.date) return
      if (!state.data.reminders.some(r => courseActive(r.courseId) && (hasStudied(r)
        ? r.pending || r.snoozedUntil !== null || r.lastNotifiedDate !== clock.date
        : reminderDue(r, now)))) return
      const fired: Array<{ title: string; courseId: string }> = []
      const saved = await mutate(data => {
        for (const r of data.reminders) {
          if (!courseActive(r.courseId)) continue
          if (hasStudied(r)) { suppressStudiedReminder(r, now); continue }
          if (!deliverReminder(r, now)) continue
          fired.push({ title: r.title, courseId: r.courseId })
        }
      })
      if (saved && state.data.desktopNotifications && fired.length) {
        const { isPermissionGranted } = await import('@tauri-apps/plugin-notification')
        if (await isPermissionGranted()) {
          // The JS Notification constructor discards the native promise; await it so failures remain visible.
          await Promise.all(fired.filter(r => !studiedForReminder(r, studied, localDayKey())).map(r => desktopInvoke('plugin:notification|notify', {
            options: { title: '学习提醒 · AI Player', body: r.title },
          })))
        } else state.notice = '系统通知未获授权，提醒仍会显示在软件内。'
      }
    } catch { state.notice = '学习状态读取或通知发送失败，将在下次检查时重试。' }
    finally { checking = false }
  }
  async function setDesktopNotifications(enabled: boolean) {
    state.notice = ''
    if (enabled) {
      try {
        const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification')
        if (!await isPermissionGranted() && await requestPermission() !== 'granted') {
          state.notice = '系统通知未获授权，请在系统设置中允许 AI Player 发送通知。软件内提醒仍可使用。'
          return false
        }
      } catch { state.notice = '暂时无法启用系统通知，软件内提醒仍可使用。'; return false }
    }
    return mutate(data => { data.desktopNotifications = enabled })
  }
  const dismiss = (id: string) => mutate(data => { const r = data.reminders.find(r => r.id === id); if (r) { r.pending = false; r.snoozedUntil = null } })
  const snooze = (id: string) => mutate(data => { const r = data.reminders.find(r => r.id === id); if (r) { r.pending = false; r.snoozedUntil = Date.now() + 10 * 60_000 } })
  async function loadMacStatus() {
    if (mac.busy) return
    try {
      const result = await desktopInvoke<{ available: boolean; links: typeof mac.links }>('mac_reminders_status')
      mac.available = result.available; mac.links = result.links; mac.ready = true; mac.error = ''
    } catch { mac.error = 'Mac 提醒事项状态读取失败，请重试。' }
  }
  function exportMacReminder(id: string): Promise<boolean> {
    if (mac.busy || !state.ready || !mac.ready) return Promise.resolve(false)
    mac.busy = true; mac.error = ''; mac.notice = ''
    exporting = (async () => {
      try {
        await queue
        const link = await desktopInvoke<(typeof mac.links)[string]>('mac_reminders_export', { reminderId: id })
        mac.links[id] = link
        mac.notice = link.snapshot?.enabled === false ? '已停用对应的 Mac 提醒，重新启用后可同步恢复。' : `已同步到 Mac 提醒事项的「${link.calendar}」列表。`
        return true
      } catch (error) { mac.error = String(error); return false }
      finally { mac.busy = false }
    })()
    return exporting
  }
  function removeMacReminder(id: string): Promise<boolean> {
    if (mac.busy || !mac.ready) return Promise.resolve(false)
    mac.busy = true; mac.error = ''; mac.notice = ''
    exporting = (async () => {
      try {
        await queue
        await desktopInvoke('mac_reminders_remove', { reminderId: id })
        delete mac.links[id]
        mac.notice = '已删除对应的 Mac 提醒。'
        return true
      } catch (error) { mac.error = String(error); return false }
      finally { mac.busy = false }
    })()
    return exporting
  }
  const macStatus = (reminder: StudyReminder) => macReminderStatus(reminder, mac.links[reminder.id], courseActive(reminder.courseId))
  const macEnabled = (reminder: StudyReminder) => reminder.enabled && courseActive(reminder.courseId)
  const orphanedMac = computed(() => Object.entries(mac.links).filter(([id]) => !state.data.reminders.some(r => r.id === id)))
  onMounted(() => { void load(); void loadMacStatus(); timer = setInterval(() => { void checkReminders() }, 15_000); window.addEventListener('focus', checkReminders) })
  onBeforeUnmount(() => { stopped = true; clearInterval(timer); window.removeEventListener('focus', checkReminders) })
  const tools = { markStudied, state, mac, load, loadMacStatus, exportMacReminder, removeMacReminder, macStatus, macEnabled, orphanedMac, mutate, pending, dismiss, snooze, setDesktopNotifications, checkReminders, flush: async () => { await queue; await exporting } }
  provide(KEY, tools)
  return tools
}
export function useStudyTools() {
  const tools = inject(KEY)
  if (!tools) throw new Error('Study tools provider is missing')
  return tools
}

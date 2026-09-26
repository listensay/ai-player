import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { databaseRequest, flushDatabaseWrites } from '~/utils/database'
import { localDayKey } from '~/utils/learningFeedback'
import { calculateDay, daySnapshot } from '~/utils/dailyPlan'
import { restoreHomeCourse, reviewDay, type HomeCourse } from '~/utils/learningHome'
import { addDays } from '~/utils/studyProgram'

export function useLearningHome() {
  const courses = ref<HomeCourse[]>([]), loading = ref(true), error = ref(''), date = ref(localDayKey())
  const availableMinutes = ref(0), settingsReady = ref(false)
  const weekOffset = ref(0), selectedDate = ref(date.value)
  let generation = 0, timer: ReturnType<typeof setInterval> | undefined
  let writing = Promise.resolve()
  async function refresh() {
    const token = ++generation
    loading.value = true; error.value = ''
    try {
      await flushDatabaseWrites()
      const [raw, minutes] = await Promise.all([
        databaseRequest<unknown[]>('dashboard'), databaseRequest<unknown>('settings', { query: { key: 'home-available-minutes' } }),
      ])
      if (token !== generation) return
      if (!Array.isArray(raw)) throw new Error('课程库读取失败。')
      courses.value = raw.map(restoreHomeCourse)
      availableMinutes.value = typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 0 && minutes <= 1440 ? minutes : 0
      settingsReady.value = true
      await captureToday()
    } catch (e) { if (token === generation) error.value = `学习首页读取失败：${String(e)}` }
    finally { if (token === generation) loading.value = false }
  }
  async function captureToday() {
    const results = await Promise.allSettled(courses.value.filter(c => c.context?.plan).map(async entry => {
      const snapshot = daySnapshot(entry.context!, date.value)
      snapshot.initialMinutes = entry.snapshots[date.value]?.initialMinutes ?? snapshot.plannedMinutes
      await databaseRequest('day-snapshots', { method: 'POST', body: { courseId: entry.course.id, snapshot } })
      entry.snapshots[date.value] = snapshot
    }))
    if (results.some(r => r.status === 'rejected')) error.value = '部分每日计划保存失败，请重试。'
  }
  function saveAvailable(value: unknown) {
    if (!settingsReady.value) return
    const minutes = Number(value)
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) { error.value = '每日可用时间应为 0–1440 分钟。'; return }
    writing = writing.catch(() => {}).then(async () => {
      await databaseRequest('settings', { method: 'POST', body: { key: 'home-available-minutes', value: minutes } })
    }).catch(() => { error.value = '每日可用时间保存失败，请重试。' })
  }
  const plans = computed(() => courses.value.filter(c => c.context).map(entry => ({ entry, day: calculateDay(entry.context!, date.value) })))
  const today = computed(() => reviewDay(courses.value, date.value))
  const week = computed(() => {
    const weekday = new Date(date.value).getUTCDay() || 7
    const start = addDays(date.value, 1 - weekday + weekOffset.value * 7)
    return Array.from({ length: 7 }, (_, i) => reviewDay(courses.value, addDays(start, i)))
  })
  const selected = computed(() => reviewDay(courses.value, selectedDate.value))
  function moveWeek(offset: number) { weekOffset.value = Math.min(0, weekOffset.value + offset); selectedDate.value = week.value.find(day => day.date === date.value)?.date ?? week.value[0]!.date }
  async function checkDay() {
    const next = localDayKey()
    if (date.value !== next) { date.value = next; selectedDate.value = next; weekOffset.value = 0 }
    await refresh()
  }
  onMounted(() => { void refresh(); window.addEventListener('focus', checkDay); timer = setInterval(() => { if (date.value !== localDayKey()) void checkDay() }, 30_000) })
  onBeforeUnmount(() => { generation++; clearInterval(timer); window.removeEventListener('focus', checkDay) })
  return { courses, loading, error, date, refresh, availableMinutes, saveAvailable, plans, today, week, weekOffset, selectedDate, selected, moveWeek }
}

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { startPerformanceMeasure } from '~/utils/performance'
import { databaseRequest, flushDatabaseWrites } from '~/utils/database'
import { localDayKey } from '~/utils/learningFeedback'
import { calculateDay } from '~/utils/dailyPlan'
import { reviewDay, type HomeCourse } from '~/utils/learningHome'
import { readLearningCourses, resetLearningData } from '~/utils/learningData'
import { subscribeDatabaseChanges } from '~/utils/databaseChanges'
import { saveHomeSnapshots } from '~/utils/homeSnapshots'
import { addDays } from '~/utils/studyProgram'

export function useLearningHome() {
  const courses = ref<HomeCourse[]>([]),
    loading = ref(true),
    error = ref(''),
    date = ref(localDayKey())
  const availableMinutes = ref(0),
    settingsReady = ref(false)
  const weekOffset = ref(0),
    selectedDate = ref(date.value)
  let stopped = false,
    dirty = false,
    settingsDirty = true,
    settingsRevision = 0,
    lastSavedMinutes: number | undefined,
    timer: ReturnType<typeof setInterval> | undefined,
    refreshTimer: ReturnType<typeof setTimeout> | undefined,
    refreshing: Promise<void> | undefined
  let writing = Promise.resolve()
  function refresh() {
    dirty = true
    if (refreshing) return refreshing
    refreshing = (async () => {
      const measure = startPerformanceMeasure('home-load')
      loading.value = !settingsReady.value
      try {
        while (dirty && !stopped) {
          dirty = false
          error.value = ''
          await flushDatabaseWrites()
          const day = localDayKey(),
            revision = settingsRevision
          const [entries, minutes] = await Promise.all([
            readLearningCourses(day),
            settingsDirty
              ? databaseRequest<unknown>('settings', { query: { key: 'home-available-minutes' } })
              : lastSavedMinutes,
          ])
          if (stopped) return
          if (day !== localDayKey()) {
            dirty = true
            continue
          }
          if (date.value !== day) {
            date.value = day
            selectedDate.value = day
            weekOffset.value = 0
          }
          if (settingsDirty && revision === settingsRevision) {
            lastSavedMinutes =
              typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 0 && minutes <= 1440 ? minutes : 0
            availableMinutes.value = lastSavedMinutes
            settingsDirty = false
          }
          settingsReady.value = true
          try {
            await saveHomeSnapshots(entries, day, databaseRequest, () => stopped || localDayKey() !== day)
          } finally {
            if (!stopped && localDayKey() === day) courses.value = entries
          }
        }
        if (!stopped) measure.finish()
      } catch (e) {
        if (!stopped) error.value = `学习首页刷新失败：${String(e)}`
      } finally {
        measure.cancel()
        if (!stopped) loading.value = false
      }
    })().finally(() => {
      refreshing = undefined
    })
    return refreshing
  }
  function saveAvailable(value: unknown) {
    if (!settingsReady.value) return
    const minutes = Number(value)
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      error.value = '每日可用时间应为 0–1440 分钟。'
      return
    }
    writing = writing
      .catch(() => {})
      .then(async () => {
        if (minutes === lastSavedMinutes) return
        await databaseRequest('settings', { method: 'POST', body: { key: 'home-available-minutes', value: minutes } })
        lastSavedMinutes = minutes
      })
      .catch(() => {
        error.value = '每日可用时间保存失败，请重试。'
      })
  }
  const plans = computed(() =>
    courses.value.filter((c) => c.context).map((entry) => ({ entry, day: calculateDay(entry.context!, date.value) })),
  )
  const today = computed(() => reviewDay(courses.value, date.value))
  const week = computed(() => {
    const weekday = new Date(date.value).getUTCDay() || 7
    const start = addDays(date.value, 1 - weekday + weekOffset.value * 7)
    return Array.from({ length: 7 }, (_, i) => reviewDay(courses.value, addDays(start, i)))
  })
  const selected = computed(() => reviewDay(courses.value, selectedDate.value))
  function moveWeek(offset: number) {
    weekOffset.value = Math.min(0, weekOffset.value + offset)
    selectedDate.value = week.value.find((day) => day.date === date.value)?.date ?? week.value[0]!.date
  }
  function schedule() {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void refresh(), 250)
  }
  const unsubscribe = subscribeDatabaseChanges((collection, options) => {
    if (collection === 'settings' && (options.body as { key?: string })?.key === 'home-available-minutes') {
      settingsDirty = true
      settingsRevision++
      schedule()
    } else if (
      ['recent-courses', 'library', 'learning-plan', 'guide', 'progress', 'check-in'].includes(collection) ||
      (collection === 'settings' &&
        /^(study-records:|daily-practice:)/u.test((options.body as { key?: string })?.key ?? ''))
    )
      schedule()
  })
  onMounted(() => {
    void refresh()
    window.addEventListener('focus', schedule)
    timer = setInterval(() => {
      if (date.value !== localDayKey()) void refresh()
    }, 30_000)
  })
  onBeforeUnmount(() => {
    stopped = true
    unsubscribe()
    clearTimeout(refreshTimer)
    clearInterval(timer)
    window.removeEventListener('focus', schedule)
  })
  return {
    courses,
    loading,
    error,
    date,
    refresh: () => {
      resetLearningData()
      settingsDirty = true
      return refresh()
    },
    availableMinutes,
    saveAvailable,
    plans,
    today,
    week,
    weekOffset,
    selectedDate,
    selected,
    moveWeek,
  }
}

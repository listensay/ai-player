import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { startPerformanceMeasure } from '~/utils/performance'
import { databaseRequest, flushDatabaseWrites } from '~/utils/database'
import { localDayKey } from '~/utils/learningFeedback'
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
  const weekOffset = ref(0),
    selectedDate = ref(date.value)
  let loaded = false,
    stopped = false,
    dirty = false,
    timer: ReturnType<typeof setInterval> | undefined,
    refreshTimer: ReturnType<typeof setTimeout> | undefined,
    refreshing: Promise<void> | undefined
  function refresh() {
    dirty = true
    if (refreshing) return refreshing
    refreshing = (async () => {
      const measure = startPerformanceMeasure('home-load')
      loading.value = !loaded
      try {
        while (dirty && !stopped) {
          dirty = false
          error.value = ''
          await flushDatabaseWrites()
          const day = localDayKey()
          const entries = await readLearningCourses(day)
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
          loaded = true
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
    if (
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
      return refresh()
    },
    today,
    week,
    weekOffset,
    selectedDate,
    selected,
    moveWeek,
  }
}

import type { InjectionKey, Ref } from 'vue'
import type { Course } from '~/types/course'
import type { TodayPlan } from '~/types/guide'
import type { PlaybackSample } from '~/types/practice'
import type { StudyDay } from '~/types/checkIn'
import { checkStudyDay, effectivePlaybackSeconds, restoreStudyDays, setStudyTarget, splitStudySeconds, studyStreak } from '~/utils/checkIn'
import { localDayKey } from '~/utils/learningFeedback'
import { dbFetchCheckIns, dbSaveCheckIns } from '~/utils/dbClient'

const OLD_STORAGE_PREFIX = 'ai-player.check-in.v1.'

export type StudyCheckInInstance = ReturnType<typeof useStudyCheckIn>
export const CHECK_IN_KEY: InjectionKey<StudyCheckInInstance> = Symbol('study-check-in')

export function useStudyCheckIn(course: Ref<Course | null>, plan: Ref<{ today: TodayPlan | null; dailyMinutes: number }>) {
  const state = reactive({ days: {} as Record<string, StudyDay>, date: localDayKey(), storageError: '' })
  const justCheckedIn = ref<StudyDay | null>(null)
  let activeId = ''
  let previous: { sample: PlaybackSample; wall: number; path: string } | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let dayTimer: ReturnType<typeof setInterval> | undefined

  const current = computed(() => state.days[state.date])
  const streak = computed(() => studyStreak(state.days, state.date))
  const total = computed(() => Object.values(state.days).filter(day => day.checkedAt !== null).length)
  const isAchieved = computed(() => !!current.value?.checkedAt)
  const targetSeconds = computed(() => current.value?.targetSeconds ?? minutesFor(state.date) * 60)
  const seconds = computed(() => current.value?.seconds ?? 0)
  const percent = computed(() => {
    const target = targetSeconds.value
    if (target <= 0) return 0
    return Math.min(100, Math.round((seconds.value / target) * 100))
  })
  const remainingSeconds = computed(() => Math.max(0, targetSeconds.value - seconds.value))

  function minutesFor(date: string) {
    return plan.value.today?.date === date ? plan.value.today.minutes : plan.value.dailyMinutes
  }

  function ensureDay(date: string) {
    if (!state.days[date]) state.days[date] = { date, seconds: 0, targetSeconds: minutesFor(date) * 60, checkedAt: null }
    return state.days[date]!
  }

  function persist() {
    clearTimeout(saveTimer); saveTimer = undefined
    if (!activeId) return
    void dbSaveCheckIns(activeId, Object.values(state.days))
  }

  function scheduleSave() { if (!saveTimer) saveTimer = setTimeout(persist, 2000) }

  function syncDay() {
    state.date = localDayKey()
    if (!activeId || activeId !== course.value?.id) return
    const day = ensureDay(state.date)
    setStudyTarget(day, minutesFor(state.date), Date.now())
    scheduleSave()
  }

  function sample(path: string, sample: PlaybackSample) {
    if (!activeId || course.value?.id !== activeId || !course.value.videos.some(v => v.path === path)) { previous = null; return }
    syncDay()
    const now = Date.now()
    const elapsed = previous && previous.path === path ? effectivePlaybackSeconds(previous.sample, sample) : 0
    // 系统时间被大幅调整时，不把两个不连续日期拼成一次学习。
    const wallMatches = previous && Math.abs((now - previous.wall) - (sample.at - previous.sample.at)) < 2000
    if (elapsed > 0 && wallMatches) {
      for (const part of splitStudySeconds(now, elapsed)) {
        const day = ensureDay(part.date)
        const wasChecked = day.checkedAt !== null
        day.seconds = Math.min(86400, day.seconds + part.seconds)
        checkStudyDay(day, now)
        if (!wasChecked && day.checkedAt !== null) {
          justCheckedIn.value = { ...day }
          persist()
        }
      }
      scheduleSave()
    }
    previous = { sample, wall: now, path }
    if (!sample.playing || sample.ended) persist()
  }

  function resetPlayback() { previous = null }

  watch(() => course.value?.id, async () => {
    persist(); resetPlayback(); activeId = course.value?.id ?? ''
    state.days = {}; state.storageError = ''; state.date = localDayKey()
    justCheckedIn.value = null
    if (!activeId) return

    try {
      // 1. 从 SQLite 读取
      const dbDays = await dbFetchCheckIns(activeId)
      // 2. 检查并迁移旧 localStorage 数据
      if (import.meta.client) {
        try {
          const old = localStorage.getItem(OLD_STORAGE_PREFIX + activeId)
          if (old) {
            const restored = restoreStudyDays(JSON.parse(old))
            for (const [k, v] of Object.entries(restored)) {
              if (!dbDays[k]) dbDays[k] = v
            }
            void dbSaveCheckIns(activeId, Object.values(dbDays))
            localStorage.removeItem(OLD_STORAGE_PREFIX + activeId)
          }
        } catch { /* 忽略旧缓存迁移异常 */ }
      }
      state.days = dbDays
    } catch {
      state.storageError = '打卡记录读取失败，本次学习会重新记录。'
    }
  }, { immediate: true, flush: 'sync' })

  watch(() => [course.value?.id, plan.value.today?.date, plan.value.today?.minutes, plan.value.dailyMinutes], syncDay, { immediate: true })

  onMounted(() => {
    dayTimer = setInterval(syncDay, 1000)
    window.addEventListener('beforeunload', persist)
    window.addEventListener('pagehide', persist)
    window.addEventListener('focus', syncDay)
  })

  onBeforeUnmount(() => {
    persist(); clearInterval(dayTimer)
    window.removeEventListener('beforeunload', persist)
    window.removeEventListener('pagehide', persist)
    window.removeEventListener('focus', syncDay)
  })

  const instance = {
    state,
    current,
    streak,
    total,
    isAchieved,
    targetSeconds,
    seconds,
    percent,
    remainingSeconds,
    justCheckedIn,
    minutesFor,
    ensureDay,
    sample,
    resetPlayback,
    persist,
  }

  provide(CHECK_IN_KEY, instance)
  return instance
}

export function useCheckIn() {
  const checkIn = inject(CHECK_IN_KEY, null)
  return checkIn
}

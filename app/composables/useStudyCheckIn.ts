import { onBeforeUnmount, onMounted, computed, reactive, ref, watch, inject, provide } from 'vue'
import type { InjectionKey, Ref } from 'vue'
import type { Course } from '~/types/course'
import type { TodayPlan } from '~/types/guide'
import type { PlaybackSample } from '~/types/practice'
import type { StudyDay } from '~/types/checkIn'
import { checkStudyDay, effectivePlaybackSeconds, setStudyTarget, splitStudySeconds, studyStreak } from '~/utils/checkIn'
import { localDayKey } from '~/utils/learningFeedback'
import { dbFetchCheckIns, dbSaveCheckIns } from '~/utils/dbClient'


export type StudyCheckInInstance = ReturnType<typeof useStudyCheckIn>
export const CHECK_IN_KEY: InjectionKey<StudyCheckInInstance> = Symbol('study-check-in')

export interface CheckInPlan {
  today: TodayPlan | null
  dailyMinutes: number
  /** 设置完整学习计划后，当日目标为全部时间分配之和（看课 + 实践）。 */
  targetMinutes?: number | null
  /** 各日期记录的实践时间（秒），计入当日学习时长。 */
  workSeconds?: Record<string, number>
  budgetForDate?: (date: string) => number
}

export function useStudyCheckIn(course: Ref<Course | null>, plan: Ref<CheckInPlan>) {
  const state = reactive({ days: {} as Record<string, StudyDay>, date: localDayKey(), storageError: '' })
  const justCheckedIn = ref<StudyDay | null>(null)
  let activeId = ''
  let ready = false
  let previous: { sample: PlaybackSample; wall: number; path: string } | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let dayTimer: ReturnType<typeof setInterval> | undefined

  const current = computed(() => state.days[state.date])
  const streak = computed(() => studyStreak(state.days, state.date))
  const total = computed(() => Object.values(state.days).filter(day => day.checkedAt !== null).length)
  const isAchieved = computed(() => !!current.value?.checkedAt)
  const targetSeconds = computed(() => current.value?.targetSeconds ?? minutesFor(state.date) * 60)
  const includesWork = computed(() => plan.value.targetMinutes != null)
  const workFor = (date: string) => plan.value.workSeconds?.[date] ?? 0
  /** 当日学习时长：有效看课时长 + 记录的实践时间。 */
  const secondsFor = (date: string) => Math.min(86400, (state.days[date]?.seconds ?? 0) + workFor(date))
  const seconds = computed(() => secondsFor(state.date))
  const percent = computed(() => {
    const target = targetSeconds.value
    if (target <= 0) return 0
    return Math.min(100, Math.round((seconds.value / target) * 100))
  })
  const remainingSeconds = computed(() => Math.max(0, targetSeconds.value - seconds.value))

  function minutesFor(date: string) {
    if (date === state.date && plan.value.targetMinutes != null) return plan.value.targetMinutes
    if (date >= state.date && plan.value.budgetForDate) return plan.value.budgetForDate(date)
    return plan.value.today?.date === date ? plan.value.today.minutes : plan.value.dailyMinutes
  }

  function ensureDay(date: string) {
    if (!state.days[date]) state.days[date] = { date, seconds: 0, targetSeconds: minutesFor(date) * 60, checkedAt: null }
    return state.days[date]!
  }

  function persist() {
    clearTimeout(saveTimer); saveTimer = undefined
    if (!activeId || !ready) return
    void dbSaveCheckIns(activeId, Object.values(state.days))
  }

  function scheduleSave() { if (!saveTimer) saveTimer = setTimeout(persist, 2000) }

  function syncDay() {
    state.date = localDayKey()
    if (!activeId || !ready || activeId !== course.value?.id) return
    const day = ensureDay(state.date)
    const wasChecked = day.checkedAt !== null
    setStudyTarget(day, minutesFor(state.date), Date.now(), workFor(state.date))
    // 记录实践时间后达到目标，同样视为当日打卡。
    if (!wasChecked && day.checkedAt !== null) { justCheckedIn.value = { ...day }; persist() }
    scheduleSave()
  }

  function sample(path: string, sample: PlaybackSample) {
    if (!activeId || !ready || course.value?.id !== activeId || !course.value.videos.some(v => v.path === path)) { previous = null; return }
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
        checkStudyDay(day, now, workFor(part.date))
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

  watch(() => course.value?.id, async (_id, _oldId, onCleanup) => {
    let stale = false
    onCleanup(() => { stale = true })
    persist(); resetPlayback(); activeId = course.value?.id ?? ''
    ready = false
    state.days = {}; state.storageError = ''; state.date = localDayKey()
    justCheckedIn.value = null
    if (!activeId) return

    try {
      // 从 SQLite 读取
      const dbDays = await dbFetchCheckIns(activeId)
      if (stale) return
      state.days = dbDays
      ready = true
      syncDay()
    } catch {
      if (stale) return
      state.storageError = '打卡记录读取失败，已暂停保存并保留原有记录。请重新打开课程后重试。'
    }
  }, { immediate: true, flush: 'sync' })

  watch(() => [course.value?.id, plan.value.today?.date, plan.value.today?.minutes, plan.value.dailyMinutes, plan.value.targetMinutes, workFor(state.date)], syncDay, { immediate: true })

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
    secondsFor,
    includesWork,
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

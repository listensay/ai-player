import { onBeforeUnmount, onMounted, computed, reactive, ref, watch, inject, provide } from 'vue'
import type { InjectionKey, Ref } from 'vue'
import type { Course } from '~/types/course'
import type { TodayPlan, WorkEntry } from '~/types/guide'
import type { PlaybackSample } from '~/types/practice'
import type { StudyDay } from '~/types/checkIn'
import {
  checkStudyDay,
  effectivePlaybackSeconds,
  setStudyTarget,
  splitStudySeconds,
  studyPlanProgress,
  studyStreak,
} from '~/utils/checkIn'
import { localDayKey } from '~/utils/learningFeedback'
import { dbFetchCheckIns, dbSaveCheckIns } from '~/utils/dbClient'
import { createStudyClock, type StudyClockContext } from '~/utils/studyClock'

export type StudyCheckInInstance = ReturnType<typeof useStudyCheckIn>
export const CHECK_IN_KEY: InjectionKey<StudyCheckInInstance> = Symbol('study-check-in')

export interface CheckInPlan {
  today: TodayPlan | null
  dailyMinutes: number
  startDate?: string | null
  endDate?: string | null
  /** 设置完整学习计划后，当日目标为全部时间分配之和（看课 + 实践）。 */
  targetMinutes?: number | null
  /** 各日期记录的实践时间（秒），计入当日学习时长。 */
  workSeconds?: Record<string, number>
  workItems?: WorkEntry[]
  ready?: boolean
  budgetForDate?: (date: string) => number
}

export function useStudyCheckIn(
  course: Ref<Course | null>,
  plan: Ref<CheckInPlan>,
  session?: Readonly<Ref<StudyClockContext | null>>,
) {
  const state = reactive({ days: {} as Record<string, StudyDay>, date: localDayKey(), storageError: '' })
  const justCheckedIn = ref<StudyDay | null>(null)
  let activeId = ''
  let ready = false
  let previous: { sample: PlaybackSample; wall: number; path: string } | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let dayTimer: ReturnType<typeof setInterval> | undefined
  let saves: Promise<boolean> = Promise.resolve(true)
  const clock = createStudyClock(({ courseId, kind }, end, seconds) => addSeconds(courseId, kind, end, seconds))

  const current = computed(() => state.days[state.date])
  const streak = computed(() => studyStreak(state.days, state.date))
  const total = computed(() => Object.values(state.days).filter((day) => day.checkedAt !== null).length)
  const isAchieved = computed(() => !!current.value?.checkedAt)
  const targetSeconds = computed(() => current.value?.targetSeconds ?? minutesFor(state.date) * 60)
  const includesWork = computed(() => session !== undefined || plan.value.targetMinutes != null)
  const startDate = computed(() => plan.value.startDate ?? null)
  const endDate = computed(() => plan.value.endDate ?? null)
  const workFor = (date: string) => (plan.value.workSeconds?.[date] ?? 0) + (state.days[date]?.practiceSeconds ?? 0)
  /** 当日学习时长：网课用时 + 实践用时。 */
  const secondsFor = (date: string) => Math.min(86400, (state.days[date]?.seconds ?? 0) + workFor(date))
  const seconds = computed(() => secondsFor(state.date))
  const taskProgress = computed(() =>
    plan.value.ready === false
      ? null
      : studyPlanProgress(plan.value.today, state.date, minutesFor(state.date) * 60, plan.value.workItems),
  )
  const percent = computed(() => {
    if (isAchieved.value) return 100
    const target = targetSeconds.value
    if (target <= 0) return 0
    return Math.min(99, Math.round(Math.max(seconds.value / target, taskProgress.value ?? 0) * 100))
  })
  const remainingSeconds = computed(() => Math.max(0, targetSeconds.value - seconds.value))

  function minutesFor(date: string) {
    if (date === state.date && plan.value.targetMinutes != null) return plan.value.targetMinutes
    if (date < state.date && state.days[date]) return state.days[date]!.targetSeconds / 60
    if (plan.value.budgetForDate) return plan.value.budgetForDate(date)
    return plan.value.today?.date === date ? plan.value.today.minutes : plan.value.dailyMinutes
  }

  function ensureDay(date: string) {
    if (!state.days[date])
      state.days[date] = { date, seconds: 0, targetSeconds: minutesFor(date) * 60, checkedAt: null }
    return state.days[date]!
  }

  function persist() {
    clearTimeout(saveTimer)
    saveTimer = undefined
    if (!activeId || !ready) return Promise.resolve(true)
    const id = activeId
    const days = Object.values(state.days).map((day) => ({ ...day }))
    const task = saves
      .then(() => dbSaveCheckIns(id, days))
      .catch(() => false)
      .then((saved) => {
        if (id === activeId && ready) {
          if (!saved) state.storageError = '学习时间保存失败，请重试。'
          else if (state.storageError === '学习时间保存失败，请重试。') state.storageError = ''
        }
        return saved
      })
    saves = task
    return task
  }

  function scheduleSave() {
    if (!saveTimer) saveTimer = setTimeout(persist, 2000)
  }

  function tickSession() {
    if (session) clock.tick(ready ? session.value : null)
  }

  function addSeconds(id: string, kind: 'video' | 'practice', end: number, seconds: number) {
    if (!ready || id !== activeId) return
    for (const part of splitStudySeconds(end, seconds)) {
      const day = ensureDay(part.date)
      const wasChecked = day.checkedAt !== null
      const added = Math.min(part.seconds, Math.max(0, 86400 - day.seconds - (day.practiceSeconds ?? 0)))
      if (kind === 'video') day.seconds += added
      else day.practiceSeconds = (day.practiceSeconds ?? 0) + added
      checkStudyDay(day, end, workFor(part.date))
      if (!wasChecked && day.checkedAt !== null) {
        justCheckedIn.value = { ...day }
        persist()
      }
    }
    scheduleSave()
  }

  function syncDay() {
    state.date = localDayKey()
    if (!activeId || !ready || activeId !== course.value?.id) return
    const day = ensureDay(state.date)
    const wasChecked = day.checkedAt !== null
    setStudyTarget(day, minutesFor(state.date), Date.now(), workFor(state.date), taskProgress.value === 1)
    // 完成原日安排或累计实际投入达标，均可打卡；实际用时不补造。
    if (!wasChecked && day.checkedAt !== null) {
      justCheckedIn.value = { ...day }
      persist()
    }
    scheduleSave()
  }

  function sample(path: string, sample: PlaybackSample) {
    if (session) return
    if (!activeId || !ready || course.value?.id !== activeId || !course.value.videos.some((v) => v.path === path)) {
      previous = null
      return
    }
    syncDay()
    const now = Date.now()
    const elapsed = previous && previous.path === path ? effectivePlaybackSeconds(previous.sample, sample) : 0
    // 系统时间被大幅调整时，不把两个不连续日期拼成一次学习。
    const wallMatches = previous && Math.abs(now - previous.wall - (sample.at - previous.sample.at)) < 2000
    if (elapsed > 0 && wallMatches) {
      addSeconds(activeId, 'video', now, elapsed)
    }
    previous = { sample, wall: now, path }
    if (!sample.playing || sample.ended) persist()
  }

  function resetPlayback() {
    previous = null
  }

  watch(
    () => course.value?.id,
    async (_id, _oldId, onCleanup) => {
      let stale = false
      onCleanup(() => {
        stale = true
      })
      tickSession()
      persist()
      clock.reset()
      resetPlayback()
      activeId = course.value?.id ?? ''
      ready = false
      state.days = {}
      state.storageError = ''
      state.date = localDayKey()
      justCheckedIn.value = null
      if (!activeId) return

      try {
        // 从 SQLite 读取
        const dbDays = await dbFetchCheckIns(activeId)
        if (stale) return
        state.days = dbDays
        ready = true
        syncDay()
        tickSession()
      } catch {
        if (stale) return
        state.storageError = '打卡记录读取失败，已暂停保存并保留原有记录。请重新打开课程后重试。'
      }
    },
    { immediate: true, flush: 'sync' },
  )

  watch(
    () => session?.value,
    () => {
      tickSession()
      syncDay()
      persist()
    },
    { flush: 'sync' },
  )

  watch(
    () => [
      course.value?.id,
      plan.value.today?.date,
      plan.value.today?.minutes,
      plan.value.dailyMinutes,
      plan.value.targetMinutes,
      workFor(state.date),
      taskProgress.value,
    ],
    syncDay,
    { immediate: true },
  )

  onMounted(() => {
    dayTimer = setInterval(() => {
      tickSession()
      syncDay()
    }, 1000)
    window.addEventListener('beforeunload', finishSession)
    window.addEventListener('pagehide', finishSession)
    window.addEventListener('focus', syncDay)
  })

  onBeforeUnmount(() => {
    finishSession()
    clearInterval(dayTimer)
    window.removeEventListener('beforeunload', finishSession)
    window.removeEventListener('pagehide', finishSession)
    window.removeEventListener('focus', syncDay)
  })

  function finishSession() {
    tickSession()
    clock.reset()
    return persist()
  }

  const instance = {
    state,
    current,
    streak,
    total,
    isAchieved,
    targetSeconds,
    seconds,
    taskProgress,
    percent,
    remainingSeconds,
    justCheckedIn,
    minutesFor,
    secondsFor,
    includesWork,
    startDate,
    endDate,
    ensureDay,
    sample,
    resetPlayback,
    persist,
    finishSession,
  }

  provide(CHECK_IN_KEY, instance)
  return instance
}

export function useCheckIn() {
  const checkIn = inject(CHECK_IN_KEY, null)
  return checkIn
}

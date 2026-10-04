import { computed, inject, onBeforeUnmount, onMounted, provide, reactive, ref, type InjectionKey } from 'vue'
import { databaseRequest, flushDatabaseWrites } from '~/utils/database'
import { subscribeDatabaseChanges } from '~/utils/databaseChanges'
import { buildStudyInsights, digestPeriod, restoreStudyEvidence } from '~/utils/studyInsights'
import { restoreHomeCourse } from '~/utils/learningHome'
import { restorePomodoro } from '~/utils/pomodoro'
import { createMilestoneState, createMilestoneTracker } from '~/utils/milestoneTracker'
import { type Milestone } from '~/utils/milestones'
import { createPomodoroAudio } from '~/utils/pomodoroAudio'
const STORAGE_KEY = 'milestones:v1'
const KEY: InjectionKey<ReturnType<typeof provideMilestones>> = Symbol('milestones')
export function provideMilestones() {
  const state = reactive(createMilestoneState())
  const celebration = ref<Milestone[]>([])
  const audio = createPomodoroAudio()
  const tracker = createMilestoneTracker(
    {
      readLedger: () => databaseRequest('settings', { query: { key: STORAGE_KEY } }),
      async readBadges() {
        await flushDatabaseWrites()
        const [rawCourses, rawEvidence, rawFocus] = await Promise.all([
          databaseRequest<unknown[]>('dashboard'),
          databaseRequest('study-evidence'),
          databaseRequest('settings', { query: { key: 'pomodoro:v1' } }),
        ])
        if (!Array.isArray(rawCourses)) throw Error('课程库读取失败。')
        const courses = rawCourses.map((raw) => restoreHomeCourse(raw))
        if (courses.some((course) => course.error || !course.context)) throw Error('部分课程记录不可用，请修复后重试。')
        return buildStudyInsights(
          courses,
          restoreStudyEvidence(rawEvidence),
          restorePomodoro(rawFocus).focusHistory ?? [],
          digestPeriod('week', 0),
        ).badges
      },
      saveLedger: (ledger) =>
        databaseRequest('settings', { method: 'POST', body: { key: STORAGE_KEY, value: ledger } }),
      celebrate(badges) {
        celebration.value = [
          ...celebration.value,
          ...badges.filter((badge) => !celebration.value.some((b) => b.id === badge.id)),
        ]
        void audio.play('long-break')
      },
    },
    state,
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe: (() => void) | undefined
  function schedule() {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      void tracker.refresh()
    }, 1200)
  }
  onMounted(() => {
    unsubscribe = subscribeDatabaseChanges((collection, options) => {
      const key = (options.body as { key?: string } | undefined)?.key
      if (
        ['progress', 'check-in', 'notes', 'practice', 'guide', 'library'].includes(collection) ||
        (collection === 'settings' && key === 'pomodoro:v1')
      )
        schedule()
    })
    window.addEventListener('focus', schedule)
    window.addEventListener('pointerdown', audio.unlock, { once: true })
    window.addEventListener('keydown', audio.unlock, { once: true })
    void tracker.refresh()
  })
  onBeforeUnmount(() => {
    tracker.dispose()
    unsubscribe?.()
    clearTimeout(timer)
    audio.dispose()
    window.removeEventListener('focus', schedule)
    window.removeEventListener('pointerdown', audio.unlock)
    window.removeEventListener('keydown', audio.unlock)
  })
  const value = {
    state,
    celebration,
    refresh: tracker.refresh,
    dismiss: () => {
      celebration.value = []
    },
    unlocked: computed(() => state.badges.filter((badge) => badge.unlocked).length),
  }
  provide(KEY, value)
  return value
}
export function useMilestones() {
  const value = inject(KEY)
  if (!value) throw Error('Milestone provider is missing')
  return value
}

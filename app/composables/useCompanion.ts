import { useCompanionWindow } from '~/composables/useCompanionWindow'
import { databaseRequest, flushDatabaseWrites } from '~/utils/database'
import { buildStudyInsights, digestPeriod } from '~/utils/studyInsights'
import { restoreHomeCourse } from '~/utils/learningHome'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { createPomodoro } from './usePomodoro'
import type { provideDesktopSettings } from './useDesktopSettings'
import type { Ref } from 'vue'
import type { Course, VideoEntry } from '~/types/course'
import type { TodayPlan } from '~/types/guide'
import type { PlaybackSample } from '~/types/practice'
import type { usePlayer } from './usePlayer'
import type { useLessonKnowledge } from './useLessonKnowledge'
import { desktopInvoke } from '~/utils/platform'
import {
  companionConcept,
  COMPANION_ACTION_EVENT,
  COMPANION_STATE_EVENT,
  createCompanionSession,
  FOCUS_SECONDS,
  REST_SECONDS,
  recordCompanionPlayback,
  restSessionIfNeeded,
  snoozeCompanionCare,
} from '~/utils/companion'
import type { CompanionAction, CompanionSnapshot } from '~/utils/companion'
import type { provideLearningManagement } from './useLearningManagement'

export function useCompanion(options: {
  learning?: ReturnType<typeof provideLearningManagement>
  pomodoro?: ReturnType<typeof createPomodoro>
  desktopSettings: ReturnType<typeof provideDesktopSettings>
  player: ReturnType<typeof usePlayer>
  course: Ref<Course | null>
  video: Ref<VideoEntry | null>
  knowledge: ReturnType<typeof useLessonKnowledge>
  concepts: Ref<string[]>
  today: Ref<TodayPlan | null>
  todayReady: Ref<boolean>
  dailyFinished: Ref<boolean>
  dailyKey: Ref<string>
  dailyReady: Ref<boolean>
  checkedAt: Ref<number | null>
  blocked: Ref<boolean>
}) {
  const { player, course, video } = options
  const session = reactive(createCompanionSession())
  const now = ref(Date.now())
  const restUntil = ref(0)
  const celebration = ref('')
  const bondLevel = ref(1)
  let growthVersion = 0
  async function refreshGrowth() {
    const token = ++growthVersion
    try {
      await flushDatabaseWrites()
      const raw = await databaseRequest<unknown[]>('dashboard')
      if (disposed || token !== growthVersion || !Array.isArray(raw)) return
      const courses = raw.map((value) => restoreHomeCourse(value))
      if (courses.some((c) => c.error)) return
      bondLevel.value = buildStudyInsights(
        courses,
        { notes: [], practices: [] },
        [],
        digestPeriod('week', 0),
        undefined,
        options.learning?.state.data.rewardDays,
      ).growth.level
    } catch {
      /* Growth decoration must never block playback or overwrite learning records. */
    }
  }
  const error = ref('')
  watch(
    () => options.learning?.state.data.rewardDays.length,
    () => {
      void refreshGrowth()
    },
  )
  const { miniOpen, opening, openMini, toggleMini } = useCompanionWindow(() => publish(true), error)
  let previous: PlaybackSample | null = null
  let previousKey = ''
  let previousWall = 0
  let celebrationTimer: ReturnType<typeof setTimeout> | undefined
  let ticker: ReturnType<typeof setInterval> | undefined
  let unlisten: (() => void) | undefined
  let disposed = false
  let bridgeReady = false
  let lastPublished = '',
    publishedAt = -Infinity
  const celebrated = new Set<string>()
  const restRemaining = computed(() => Math.max(0, Math.ceil((restUntil.value - now.value) / 1000)))
  const lessonKey = computed(() =>
    course.value && video.value ? JSON.stringify([course.value.id, video.value.path]) : '',
  )

  function sample(current: PlaybackSample) {
    const wall = Date.now()
    const continuous =
      previousKey === lessonKey.value && previous && Math.abs(wall - previousWall - (current.at - previous.at)) < 2000
    recordCompanionPlayback(session, continuous ? previous : null, current, wall)
    previous = current
    previousKey = lessonKey.value
    previousWall = wall
    now.value = wall
  }
  // Detaching the video invalidates its time sample, but keeps a short session break.
  watch(
    () => player.state.ready,
    (ready) => {
      if (!ready) previous = null
    },
  )

  function celebrate(message: string, key: string) {
    if (celebrated.has(key)) return
    celebrated.add(key)
    void refreshGrowth()
    clearTimeout(celebrationTimer)
    celebration.value = message
    celebrationTimer = setTimeout(() => {
      celebration.value = ''
    }, 6500)
  }
  watch(
    () => options.learning?.reward.value,
    (day) => {
      if (day) celebrate('抗遗忘复习完成 · 亲密度 +5', `review:${day}`)
    },
  )
  // Snapshot IDs and booleans: hydration, date changes and plan replacement aren't achievements.
  watch(
    () => ({
      key: `${course.value?.id}:${options.today.value?.date}`,
      ready: options.todayReady.value,
      items:
        options.today.value?.items.filter((i) => i.kind !== 'question').map((i) => ({ id: i.id, done: i.done })) ?? [],
    }),
    (next, old) => {
      if (!old || !old.ready || !next.ready || old.key !== next.key) return
      const completed = next.items.filter(
        (item) =>
          item.done &&
          old.items.some((before) => before.id === item.id && !before.done) &&
          !celebrated.has(`${next.key}:${item.id}`),
      )
      if (completed.length) {
        celebrate(next.items.every((i) => i.done) ? '今日计划课节完成' : '课节完成', `${next.key}:${completed[0]!.id}`)
        completed.forEach((item) => celebrated.add(`${next.key}:${item.id}`))
      }
    },
  )
  watch(
    () => ({
      key: `${course.value?.id}:${options.dailyKey.value}`,
      ready: options.dailyReady.value,
      done: options.dailyFinished.value,
    }),
    (next, old) => {
      if (old?.ready && next.ready && next.key === old.key && !old.done && next.done)
        celebrate('今日巩固完成', `daily:${next.key}`)
    },
  )
  watch(options.checkedAt, (value, old) => {
    if (value && !old) celebrate('今日学习已打卡', `check:${course.value?.id}:${value}`)
  })

  function rest() {
    player.pause()
    now.value = Date.now()
    restUntil.value = now.value + REST_SECONDS * 1000
    session.careDue = false
    previous = null
  }
  function toggle() {
    if (!player.state.ready || options.blocked.value) return
    restUntil.value = 0
    player.toggle()
  }
  watch(
    () => player.state.playing,
    (playing) => {
      if (playing) restUntil.value = 0
    },
  )
  function snooze() {
    snoozeCompanionCare(session)
  }

  const snapshot = computed<CompanionSnapshot>(() => {
    const state = player.state
    const mood = celebration.value
      ? 'celebrate'
      : restRemaining.value
        ? 'rest'
        : session.careDue
          ? 'tired'
          : state.playing && session.seconds >= FOCUS_SECONDS
            ? 'focus'
            : 'idle'
    const points =
      course.value && video.value
        ? (options.knowledge.get(course.value.id, video.value.path).summary?.points ?? [])
        : []
    return {
      bondLevel: bondLevel.value,
      quietFocus:
        !!options.learning?.state.data.preferences.quietFocus &&
        state.fullscreen &&
        options.pomodoro?.snapshot.value.phase === 'focus' &&
        options.pomodoro?.snapshot.value.status === 'running',
      lessonKey: lessonKey.value,
      lesson: video.value?.title ?? '',
      course: course.value?.name ?? '',
      ready: state.ready,
      playing: state.playing,
      buffering: state.buffering,
      blocked: options.blocked.value,
      currentTime: Math.floor(state.currentTime),
      duration: state.duration,
      sessionSeconds: Math.floor(session.seconds),
      mood,
      message:
        celebration.value ||
        (restRemaining.value
          ? '休息 3 分钟。'
          : session.careDue
            ? '学习时长 60 分钟，建议休息 3 分钟。'
            : mood === 'focus'
              ? '专注 25 分钟。'
              : state.buffering && state.playing
                ? '缓冲中。'
                : state.playing
                  ? '播放中。'
                  : state.ready
                    ? '已暂停。'
                    : '选择课节开始。'),
      celebration: celebration.value,
      careDue: session.careDue,
      restRemaining: restRemaining.value,
      concept: companionConcept(points, state.currentTime, options.concepts.value),
      pomodoro: options.pomodoro?.snapshot.value,
    }
  })
  async function publish(force = false) {
    if (!bridgeReady || disposed) return
    const value = snapshot.value,
      content = JSON.stringify(value),
      at = Date.now()
    if (!force && content === lastPublished && at - publishedAt < 2000) return
    lastPublished = content
    publishedAt = at
    const { emitTo } = await import('@tauri-apps/api/event')
    if (disposed) return
    await emitTo('companion', COMPANION_STATE_EVENT, value).catch(() => {
      if (lastPublished === content && publishedAt === at) lastPublished = ''
    })
  }
  watch(snapshot, () => {
    void publish()
  })
  // Hide the native window too: a transparent pet still covers fullscreen video.
  watch(
    () => player.state.fullscreen,
    async (fullscreen) => {
      try {
        await desktopInvoke('set_companion_fullscreen', { fullscreen })
      } catch {
        error.value = '桌宠显示状态同步失败。'
      }
    },
  )
  onMounted(async () => {
    void refreshGrowth()
    ticker = setInterval(() => {
      now.value = Date.now()
      restSessionIfNeeded(session, now.value)
      void publish() // heartbeat lets the mini window disable stale playback controls
    }, 1000)
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      unlisten = await getCurrentWindow().listen<CompanionAction>(COMPANION_ACTION_EVENT, ({ payload }) => {
        if (payload?.type === 'sync') {
          void publish(true)
          return
        }
        if (!payload || payload.lessonKey !== lessonKey.value) {
          void publish()
          return
        }
        if (payload.type === 'toggle') toggle()
        if (payload.type === 'rest') rest()
        if (payload.type === 'snooze') snooze()
        void publish()
      })
      if (disposed) {
        unlisten()
        return
      }
      bridgeReady = true
      await options.desktopSettings.load()
      if (!disposed && options.desktopSettings.state.ready && options.desktopSettings.state.autoOpenCompanion)
        await openMini()
    } catch {
      error.value = '桌面挂件连接失败。'
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    unlisten?.()
    clearInterval(ticker)
    clearTimeout(celebrationTimer)
  })
  return { snapshot, sample, openMini, toggleMini, miniOpen, opening, error, rest, toggle, snooze }
}

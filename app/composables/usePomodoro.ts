import { computed, watch, inject, onBeforeUnmount, onMounted, reactive, ref, provide, type InjectionKey } from 'vue'
import { createPomodoroAudio } from '~/utils/pomodoroAudio'
import { databaseRequest } from '~/utils/database'
import {
  defaultPomodoroSettings,
  finishPomodoro,
  freshPomodoro,
  parsePomodoroSettings,
  pomodoroDuration,
  remainingPomodoroMs,
  restorePomodoro,
} from '~/utils/pomodoro'
import type { PomodoroPhase, PomodoroRecord, PomodoroSettings, PomodoroSnapshot } from '~/types/pomodoro'
const STORAGE_KEY = 'pomodoro:v1'
export function createPomodoro(
  storage: { read: () => Promise<unknown>; write: (record: PomodoroRecord) => Promise<void> },
  clock = () => Date.now(),
  effects: { onPhaseEnd?: (phase: PomodoroPhase) => void; onStart?: () => void; onBreakStart?: () => void } = {},
) {
  const settings = defaultPomodoroSettings()
  const state = reactive({
    settings,
    timer: freshPomodoro(settings),
    ready: false,
    saving: false,
    error: '',
    notice: '',
  })
  const now = ref(clock())
  let loading: Promise<void> | undefined, writing: Promise<boolean> | undefined, pending: PomodoroRecord | undefined
  const record = (): PomodoroRecord =>
    JSON.parse(JSON.stringify({ version: 1, settings: state.settings, timer: state.timer }))
  function persist(): Promise<boolean> {
    if (!state.ready) return Promise.resolve(true)
    pending = record()
    if (writing) return writing
    state.saving = true
    writing = (async () => {
      try {
        while (pending) {
          const value: PomodoroRecord = pending
          await storage.write(value)
          if (pending === value) pending = undefined
        }
        state.error = ''
        return true
      } catch {
        state.error = '番茄钟尚未保存，请重试。'
        return false
      } finally {
        state.saving = false
      }
    })().finally(() => {
      writing = undefined
    })
    return writing
  }
  function pauseVideoForBreak() {
    try {
      effects.onBreakStart?.()
    } catch {
      // Player errors must not prevent the break countdown or completion notice.
    }
  }
  function tick() {
    now.value = clock()
    if (!state.ready || !state.settings.enabled) return
    const completedPhase = state.timer.phase
    const notice = finishPomodoro(state.timer, state.settings, now.value)
    if (notice) {
      state.notice = notice
      void persist()
      if (completedPhase === 'focus') pauseVideoForBreak()
      try {
        effects.onPhaseEnd?.(completedPhase)
      } catch {
        // Sound failure must not prevent phase completion or persistence.
      }
      return completedPhase
    }
  }
  function load(): Promise<void> {
    if (state.ready) return Promise.resolve()
    if (loading) return loading
    loading = (async () => {
      try {
        const restored = restorePomodoro(await storage.read())
        state.settings = restored.settings
        state.timer = restored.timer
        state.timer.revision = Math.max(state.timer.revision + 1, clock())
        state.ready = true
        state.error = ''
        const completedPhase = tick()
        if (state.timer.phase !== 'focus' && state.timer.status === 'running' && completedPhase !== 'focus')
          pauseVideoForBreak()
      } catch {
        state.error = '番茄钟记录读取失败，请重试；原记录已保留。'
      }
    })().finally(() => {
      loading = undefined
    })
    return loading
  }
  function start() {
    tick()
    if (!state.ready || !state.settings.enabled || state.timer.status === 'running') return
    effects.onStart?.()
    state.timer.status = 'running'
    state.timer.endsAt = now.value + state.timer.remainingMs
    state.timer.revision++
    state.notice = ''
    void persist()
  }
  function startFocus() {
    // A play event exactly at the deadline must not undo the automatic break.
    if (tick() === 'focus') return
    if (!state.ready || !state.settings.enabled) return
    if (state.timer.phase !== 'focus') {
      // Watching a video ends the break, but never discards completed focus rounds.
      const completedFocuses = state.timer.completedFocuses
      state.timer = { ...freshPomodoro(state.settings, state.timer.revision + 1), completedFocuses }
    }
    start()
  }
  function pause() {
    // A late pause command refers to the completed focus, not the just-started break.
    if (tick() === 'focus') return
    if (!state.ready || state.timer.status !== 'running') return
    state.timer.remainingMs = remainingPomodoroMs(state.timer, now.value)
    state.timer.status = 'paused'
    state.timer.endsAt = null
    state.timer.revision++
    void persist()
  }
  function reset() {
    if (!state.ready) return
    state.timer = freshPomodoro(state.settings, state.timer.revision + 1)
    state.notice = ''
    now.value = clock()
    void persist()
  }
  async function saveSettings(raw: PomodoroSettings) {
    if (!state.ready) return false
    let next: PomodoroSettings
    try {
      next = parsePomodoroSettings(raw)
    } catch (error) {
      state.error = (error as Error).message
      return false
    }
    tick()
    if (!next.enabled && state.timer.status === 'running') {
      state.timer.remainingMs = remainingPomodoroMs(state.timer, now.value)
      state.timer.status = 'paused'
      state.timer.endsAt = null
    }
    state.settings = next
    state.timer.revision++
    if (state.timer.status === 'idle') {
      state.timer.durationMs = pomodoroDuration(next, state.timer.phase)
      state.timer.remainingMs = state.timer.durationMs
      state.notice = ''
    }
    return persist()
  }
  const snapshot = computed<PomodoroSnapshot>(() => ({
    ready: state.ready,
    enabled: state.settings.enabled,
    visible: state.settings.showOnCompanion,
    phase: state.timer.phase,
    status: state.timer.status,
    remainingSeconds: Math.ceil(remainingPomodoroMs(state.timer, now.value) / 1000),
    totalSeconds: state.timer.durationMs / 1000,
    completedFocuses: state.timer.completedFocuses,
    round:
      state.timer.phase === 'focus'
        ? (state.timer.completedFocuses % state.settings.longBreakEvery) + 1
        : (Math.max(0, state.timer.completedFocuses - 1) % state.settings.longBreakEvery) + 1,
    longBreakEvery: state.settings.longBreakEvery,
    revision: state.timer.revision,
    notice: state.notice,
    error: state.error,
  }))
  async function flush() {
    if (!state.ready) return
    if (writing) await writing
    if (!(await persist())) throw Error(state.error)
  }
  return { state, snapshot, load, start, startFocus, pause, reset, tick, saveSettings, persist, flush }
}
/** Watch playback edges and initialization, not timer phases/ticks (no automatic break skipping). */
export function watchPomodoroPlayback(pomodoro: ReturnType<typeof createPomodoro>, isPlaying: () => boolean) {
  return watch(
    [isPlaying, () => pomodoro.state.ready, () => pomodoro.state.settings.enabled],
    ([playing, ready, enabled], [wasPlaying, wasReady, wasEnabled]) => {
      if (!playing || !ready || !enabled) return
      const userResumed = wasReady && wasEnabled && !wasPlaying
      // Loading/re-enabling during a break is not a request to skip it. A completion
      // notice on load also keeps an expired break waiting for a new play action.
      if (userResumed || (pomodoro.state.timer.phase === 'focus' && !pomodoro.state.notice)) pomodoro.startFocus()
    },
    { immediate: true },
  )
}
const KEY: InjectionKey<ReturnType<typeof createPomodoro>> = Symbol('pomodoro')
export function providePomodoro(isPlaying: () => boolean = () => false, pauseVideo: () => void = () => {}) {
  const audio = createPomodoroAudio()
  const pomodoro = createPomodoro(
    {
      read: () => databaseRequest('settings', { query: { key: STORAGE_KEY } }),
      write: async (value) => {
        await databaseRequest('settings', { method: 'POST', body: { key: STORAGE_KEY, value } })
      },
    },
    () => Date.now(),
    { onPhaseEnd: audio.play, onStart: audio.unlock, onBreakStart: pauseVideo },
  )
  watchPomodoroPlayback(pomodoro, isPlaying)
  let timer: ReturnType<typeof setInterval> | undefined
  const sync = () => pomodoro.tick()
  onMounted(() => {
    window.addEventListener('pointerdown', audio.unlock, true)
    window.addEventListener('keydown', audio.unlock, true)
    void pomodoro.load()
    timer = setInterval(sync, 1000)
    window.addEventListener('focus', sync)
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    window.removeEventListener('pointerdown', audio.unlock, true)
    window.removeEventListener('keydown', audio.unlock, true)
    audio.dispose()
    window.removeEventListener('focus', sync)
    void pomodoro.persist()
  })
  provide(KEY, pomodoro)
  return pomodoro
}
export function usePomodoro() {
  const pomodoro = inject(KEY)
  if (!pomodoro) throw Error('Pomodoro provider is missing')
  return pomodoro
}

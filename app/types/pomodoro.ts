export type PomodoroPhase = 'focus' | 'short-break' | 'long-break'
export type PomodoroStatus = 'idle' | 'running' | 'paused'
export interface PomodoroSettings {
  enabled: boolean
  /** Retained storage key: controls companion phase messages, not the header timer. */
  showOnCompanion: boolean
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  longBreakEvery: number
}
export interface PomodoroTimer {
  phase: PomodoroPhase
  status: PomodoroStatus
  durationMs: number
  remainingMs: number
  endsAt: number | null
  completedFocuses: number
  revision: number
}
export interface PomodoroRecord {
  version: 1
  settings: PomodoroSettings
  timer: PomodoroTimer
}
export interface PomodoroSnapshot {
  ready: boolean
  enabled: boolean
  visible: boolean
  phase: PomodoroPhase
  status: PomodoroStatus
  remainingSeconds: number
  totalSeconds: number
  completedFocuses: number
  round: number
  longBreakEvery: number
  revision: number
  notice: string
  error: string
}

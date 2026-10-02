import { restoreFocusHistory } from './studyInsights.ts'
import type { PomodoroPhase, PomodoroRecord, PomodoroSettings, PomodoroTimer } from '../types/pomodoro'
import { isRecord } from './guide.ts'
export const POMODORO_LABELS: Record<PomodoroPhase, string> = {
  focus: '专注',
  'short-break': '短休息',
  'long-break': '长休息',
}
export const defaultPomodoroSettings = (): PomodoroSettings => ({
  enabled: true,
  showOnCompanion: true,
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
})
export function pomodoroDuration(settings: PomodoroSettings, phase: PomodoroPhase) {
  return (
    (phase === 'focus'
      ? settings.focusMinutes
      : phase === 'short-break'
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes) * 60_000
  )
}
export function freshPomodoro(settings: PomodoroSettings, revision = 0): PomodoroTimer {
  const durationMs = pomodoroDuration(settings, 'focus')
  return {
    phase: 'focus',
    status: 'idle',
    durationMs,
    remainingMs: durationMs,
    endsAt: null,
    completedFocuses: 0,
    revision,
  }
}
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
export function parsePomodoroSettings(raw: unknown): PomodoroSettings {
  if (
    !isRecord(raw) ||
    typeof raw.enabled !== 'boolean' ||
    typeof raw.showOnCompanion !== 'boolean' ||
    !integer(raw.focusMinutes, 1, 180) ||
    !integer(raw.shortBreakMinutes, 1, 60) ||
    !integer(raw.longBreakMinutes, 1, 120) ||
    !integer(raw.longBreakEvery, 2, 12)
  )
    throw Error(
      '请填写有效的番茄钟设置：专注 1–180 分钟、短休息 1–60 分钟、长休息 1–120 分钟，每 2–12 次专注后长休息。',
    )
  return {
    enabled: raw.enabled,
    showOnCompanion: raw.showOnCompanion,
    focusMinutes: raw.focusMinutes,
    shortBreakMinutes: raw.shortBreakMinutes,
    longBreakMinutes: raw.longBreakMinutes,
    longBreakEvery: raw.longBreakEvery,
  }
}
export function restorePomodoro(raw: unknown): PomodoroRecord {
  if (raw === null) {
    const settings = defaultPomodoroSettings()
    return { version: 1, settings, timer: freshPomodoro(settings) }
  }
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.timer)) throw Error('番茄钟记录格式异常。')
  const settings = parsePomodoroSettings(raw.settings),
    timer = raw.timer
  if (
    !['focus', 'short-break', 'long-break'].includes(String(timer.phase)) ||
    !['idle', 'running', 'paused'].includes(String(timer.status)) ||
    !integer(timer.durationMs, 60_000, 180 * 60_000) ||
    !integer(timer.remainingMs, 1, timer.durationMs) ||
    !integer(timer.completedFocuses, 0, Number.MAX_SAFE_INTEGER - 1) ||
    !integer(timer.revision, 0, Number.MAX_SAFE_INTEGER - 1) ||
    (timer.status === 'running' ? !integer(timer.endsAt, 0, 8.64e15) || !settings.enabled : timer.endsAt !== null)
  )
    throw Error('番茄钟计时记录格式异常。')
  return {
    version: 1,
    focusHistory: restoreFocusHistory(raw.focusHistory),
    settings,
    timer: {
      phase: timer.phase as PomodoroTimer['phase'],
      status: timer.status as PomodoroTimer['status'],
      durationMs: timer.durationMs,
      remainingMs: timer.remainingMs,
      endsAt: timer.endsAt as number | null,
      completedFocuses: timer.completedFocuses,
      revision: timer.revision,
    },
  }
}
export function remainingPomodoroMs(timer: PomodoroTimer, now: number) {
  return timer.status === 'running' && timer.endsAt !== null
    ? Math.max(0, Math.min(timer.durationMs, timer.endsAt - now))
    : timer.remainingMs
}
/** During this app session, end at most one interval after sleep; startup discards old deadlines. */
export function finishPomodoro(timer: PomodoroTimer, settings: PomodoroSettings, now: number): string {
  if (timer.status !== 'running' || timer.endsAt === null || now < timer.endsAt) return ''
  const previous = timer.phase
  if (previous === 'focus') {
    timer.completedFocuses++
    timer.phase = timer.completedFocuses % settings.longBreakEvery === 0 ? 'long-break' : 'short-break'
  } else timer.phase = 'focus'
  timer.status = previous === 'focus' ? 'running' : 'idle'
  timer.revision++
  timer.durationMs = pomodoroDuration(settings, timer.phase)
  timer.remainingMs = timer.durationMs
  // Start a full break when completion is observed in the current app session, including after sleep.
  timer.endsAt = previous === 'focus' ? now + timer.durationMs : null
  return previous === 'focus'
    ? `专注完成，已开始${POMODORO_LABELS[timer.phase]} ${timer.durationMs / 60_000} 分钟。`
    : '休息结束，播放视频或手动开始下一次专注。'
}
export function formatPomodoro(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

import type { PomodoroSnapshot } from '../types/pomodoro'
import type { PlaybackSample } from '../types/practice'
import type { KnowledgePoint } from '../types/knowledge'
import { effectivePlaybackSeconds } from './checkIn.ts'

export const FOCUS_SECONDS = 25 * 60
export const CARE_SECONDS = 60 * 60
export const REST_SECONDS = 3 * 60
export type CompanionMood = 'idle' | 'focus' | 'tired' | 'celebrate' | 'rest'

export function createCompanionSession() {
  return { seconds: 0, lastActiveAt: 0, nextCareAt: CARE_SECONDS, careDue: false }
}
export type CompanionSession = ReturnType<typeof createCompanionSession>

/** A three-minute break starts a fresh session; short pauses preserve it. */
export function restSessionIfNeeded(session: CompanionSession, now: number) {
  if (session.lastActiveAt && now - session.lastActiveAt >= REST_SECONDS * 1000) {
    Object.assign(session, createCompanionSession())
  }
}

export function recordCompanionPlayback(
  session: CompanionSession,
  previous: PlaybackSample | null,
  current: PlaybackSample,
  now: number,
) {
  restSessionIfNeeded(session, now)
  // A suspended WebView or a sleeping computer must never become study time.
  const gap = previous ? (current.at - previous.at) / 1000 : 0
  if (gap <= 0 || gap > 30) return
  const seconds = effectivePlaybackSeconds(previous, current)
  if (seconds <= 0) return
  session.seconds += seconds
  session.lastActiveAt = now
  if (session.seconds >= session.nextCareAt) session.careDue = true
}

export function snoozeCompanionCare(session: CompanionSession) {
  session.careDue = false
  session.nextCareAt = session.seconds + 20 * 60
}

/** Only claim a timed concept while the playhead is inside its source range. */
export function companionConcept(points: KnowledgePoint[], seconds: number, concepts: string[]) {
  const point = points.find((p) => p.start <= seconds && seconds < p.end)
  if (point) return { label: '知识点', title: point.title, detail: point.text }
  if (concepts.length) return { label: '关键概念', title: concepts.slice(0, 3).join(' · '), detail: '暂停查看。' }
  return { label: '关键概念', title: '暂无知识点', detail: '本节未生成知识点。' }
}

export interface CompanionSnapshot {
  pomodoro?: PomodoroSnapshot
  lessonKey: string
  lesson: string
  course: string
  ready: boolean
  playing: boolean
  buffering: boolean
  blocked: boolean
  currentTime: number
  duration: number
  sessionSeconds: number
  mood: CompanionMood
  message: string
  celebration: string
  careDue: boolean
  restRemaining: number
  concept: ReturnType<typeof companionConcept>
}
export const COMPANION_STATE_EVENT = 'playbo-state'
export const COMPANION_ACTION_EVENT = 'playbo-action'
export type CompanionAction = {
  type: 'sync' | 'toggle' | 'rest' | 'snooze'
  lessonKey?: string
}

export function emptyCompanionSnapshot(): CompanionSnapshot {
  return {
    lessonKey: '',
    lesson: '',
    course: '',
    ready: false,
    playing: false,
    buffering: false,
    blocked: false,
    currentTime: 0,
    duration: 0,
    sessionSeconds: 0,
    mood: 'idle',
    message: '选择课节开始。',
    celebration: '',
    careDue: false,
    restRemaining: 0,
    concept: companionConcept([], 0, []),
  }
}

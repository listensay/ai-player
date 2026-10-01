import type { PomodoroPhase } from '../types/pomodoro'

type Note = { frequency: number; at: number; duration: number }
// Different contours and rhythms make the completed phase recognizable without looking.
const CHIMES: Record<PomodoroPhase, readonly Note[]> = {
  focus: [
    { frequency: 523.25, at: 0, duration: 0.18 },
    { frequency: 659.25, at: 0.23, duration: 0.18 },
    { frequency: 783.99, at: 0.46, duration: 0.5 },
  ],
  'short-break': [
    { frequency: 783.99, at: 0, duration: 0.24 },
    { frequency: 659.25, at: 0.34, duration: 0.5 },
  ],
  'long-break': [
    { frequency: 523.25, at: 0, duration: 0.16 },
    { frequency: 659.25, at: 0.21, duration: 0.16 },
    { frequency: 783.99, at: 0.42, duration: 0.16 },
    { frequency: 1046.5, at: 0.7, duration: 0.65 },
  ],
}

/** One audio context in the main window, independent of video volume and the companion window. */
export function createPomodoroAudio(createContext: () => AudioContext = () => new AudioContext()) {
  let context: AudioContext | undefined
  let disposed = false
  let playbackRequest = 0
  function getContext() {
    if (disposed) return
    if (!context || context.state === 'closed') context = createContext()
    return context
  }
  function unlock() {
    try {
      const active = getContext()
      if (active && active.state !== 'running') void active.resume().catch(() => {})
    } catch {
      // Unsupported/blocked audio must not interrupt the timer or video playback.
    }
  }
  async function play(phase: PomodoroPhase) {
    const request = ++playbackRequest
    const requestedAt = Date.now()
    try {
      const active = getContext()
      if (!active) return
      if (active.state !== 'running') await active.resume()
      // A blocked resume may only settle on a much later gesture; do not replay stale alarms.
      if (disposed || request !== playbackRequest || active.state !== 'running' || Date.now() - requestedAt > 2000)
        return
      const start = active.currentTime + 0.02
      for (const note of CHIMES[phase]) {
        const oscillator = active.createOscillator()
        const gain = active.createGain()
        const at = start + note.at
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(note.frequency, at)
        gain.gain.setValueAtTime(0, at)
        gain.gain.linearRampToValueAtTime(0.2, at + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.001, at + note.duration)
        gain.gain.linearRampToValueAtTime(0, at + note.duration + 0.02)
        oscillator.connect(gain)
        gain.connect(active.destination)
        oscillator.onended = () => {
          oscillator.disconnect()
          gain.disconnect()
        }
        oscillator.start(at)
        oscillator.stop(at + note.duration + 0.03)
      }
    } catch {
      // Keep the visual completion notice available even when audio fails.
    }
  }
  function dispose() {
    disposed = true
    if (context && context.state !== 'closed') void context.close().catch(() => {})
    context = undefined
  }
  return { unlock, play, dispose }
}

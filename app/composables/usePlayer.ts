import { reactive } from 'vue'
import { dbFetchSetting, dbSaveSetting } from '~/utils/dbClient'

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
export const MIN_RATE = 0.5
export const MAX_RATE = 3

interface PlayerState {
  ready: boolean
  playing: boolean
  buffering: boolean
  currentTime: number
  duration: number
  rate: number
  volume: number
  muted: boolean
  fullscreen: boolean
  fullscreenError: string
  error: string
}

const state = reactive<PlayerState>({
  ready: false,
  playing: false,
  buffering: false,
  currentTime: 0,
  duration: 0,
  rate: 1,
  volume: 1,
  muted: false,
  fullscreen: false,
  fullscreenError: '',
  error: '',
})

let el: HTMLVideoElement | null = null
let settingsLoaded = false
let fullscreenBusy = false
let restoreWindowFullscreen = false

async function loadSettings() {
  if (settingsLoaded) return
  settingsLoaded = true
  try {
    const s = await dbFetchSetting<Partial<Pick<PlayerState, 'rate' | 'volume' | 'muted'>>>('player_settings')
    if (s) {
      if (typeof s.rate === 'number') state.rate = clampRate(s.rate)
      if (typeof s.volume === 'number') state.volume = Math.min(1, Math.max(0, s.volume))
      if (typeof s.muted === 'boolean') state.muted = s.muted
    }
  } catch {
    /* 读取失败时沿用默认设置 */
  }
}

function saveSettings() {
  void dbSaveSetting('player_settings', { rate: state.rate, volume: state.volume, muted: state.muted })
}

function clampRate(r: number) {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(r * 100) / 100))
}

function clampTime(t: number) {
  const max = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : Infinity
  return Math.min(max, Math.max(0, t))
}

export function usePlayer() {
  if (typeof window !== 'undefined') loadSettings()

  function attach(video: HTMLVideoElement) {
    el = video
    video.playbackRate = state.rate
    video.volume = state.volume
    video.muted = state.muted
    state.ready = false
    state.error = ''
  }

  function detach() {
    el = null
    state.ready = false
    state.playing = false
    state.currentTime = 0
    state.duration = 0
  }

  async function play() {
    if (!el) return
    try {
      await el.play()
    } catch (err) {
      // 自动播放被拦截等情况：保持暂停即可
      if ((err as DOMException).name !== 'AbortError') console.warn(err)
    }
  }

  function pause() {
    el?.pause()
  }

  function toggle() {
    if (!el) return
    if (el.paused || el.ended) void play()
    else pause()
  }

  function seek(seconds: number) {
    if (!el) return
    const t = clampTime(seconds)
    el.currentTime = t
    state.currentTime = t
  }

  function seekBy(delta: number) {
    if (!el) return
    seek(el.currentTime + delta)
  }

  function setRate(rate: number) {
    state.rate = clampRate(rate)
    if (el) el.playbackRate = state.rate
    saveSettings()
  }

  /** 沿预设档位加减倍速 */
  function stepRate(direction: 1 | -1) {
    const idx = PLAYBACK_RATES.findIndex((r) => r >= state.rate - 0.001)
    const current = idx === -1 ? PLAYBACK_RATES.length - 1 : idx
    const next = PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, Math.max(0, current + direction))]
    if (next !== undefined) setRate(next)
  }

  function setVolume(volume: number) {
    state.volume = Math.min(1, Math.max(0, volume))
    if (state.volume > 0 && state.muted) state.muted = false
    if (el) {
      el.volume = state.volume
      el.muted = state.muted
    }
    saveSettings()
  }

  function toggleMute() {
    state.muted = !state.muted
    if (el) el.muted = state.muted
    saveSettings()
  }

  async function exitFullscreen() {
    if (!state.fullscreen) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setFullscreen(restoreWindowFullscreen)
    state.fullscreen = false
  }

  async function toggleFullscreen(container: HTMLElement | null) {
    if (!container || fullscreenBusy) return
    fullscreenBusy = true
    state.fullscreenError = ''
    try {
      if (state.fullscreen) await exitFullscreen()
      else {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const appWindow = getCurrentWindow()
        restoreWindowFullscreen = await appWindow.isFullscreen()
        await appWindow.setFullscreen(true)
        state.fullscreen = true
      }
    } catch {
      state.fullscreenError = '全屏切换失败，请重试。'
    } finally { fullscreenBusy = false }
  }

  /** 截取当前画面为 PNG（无损，方便以后 OCR），同时返回画面宽高比 */
  async function captureFrame(): Promise<{ blob: Blob; ratio: number } | null> {
    if (!el || !el.videoWidth || !el.videoHeight) return null
    const canvas = document.createElement('canvas')
    canvas.width = el.videoWidth
    canvas.height = el.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return null
    return { blob, ratio: el.videoWidth / el.videoHeight }
  }

  /** 由 VideoStage 在 <video> 事件里调用，同步状态 */
  const sync = {
    loadedMetadata(video: HTMLVideoElement) {
      state.duration = Number.isFinite(video.duration) ? video.duration : 0
      state.ready = true
      state.error = ''
    },
    timeUpdate(video: HTMLVideoElement) {
      state.currentTime = video.currentTime
    },
    durationChange(video: HTMLVideoElement) {
      state.duration = Number.isFinite(video.duration) ? video.duration : 0
    },
    play() {
      state.playing = true
    },
    pause() {
      state.playing = false
    },
    waiting() {
      state.buffering = true
    },
    playing() {
      state.buffering = false
    },
    rateChange(video: HTMLVideoElement) {
      state.rate = clampRate(video.playbackRate)
    },
    volumeChange(video: HTMLVideoElement) {
      state.volume = video.volume
      state.muted = video.muted
    },
    error(video: HTMLVideoElement) {
      const code = video.error?.code
      state.error =
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE
          ? '系统不支持当前视频编码。请将视频转换为 MP4 格式（H.264 视频 + AAC 音频）后重试。'
          : '视频加载失败，请检查文件是否完整。'
      state.playing = false
      state.buffering = false
    },
  }

  return {
    state,
    attach,
    detach,
    play,
    pause,
    toggle,
    seek,
    seekBy,
    setRate,
    stepRate,
    setVolume,
    toggleMute,
    toggleFullscreen,
    exitFullscreen,
    captureFrame,
    sync,
  }
}

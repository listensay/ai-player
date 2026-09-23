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
  error: '',
})

let el: HTMLVideoElement | null = null
let settingsLoaded = false

async function loadSettings() {
  if (settingsLoaded) return
  settingsLoaded = true
  try {
    const s = await dbFetchSetting<Partial<Pick<PlayerState, 'rate' | 'volume' | 'muted'>>>('player_settings')
    if (s) {
      if (typeof s.rate === 'number') state.rate = clampRate(s.rate)
      if (typeof s.volume === 'number') state.volume = Math.min(1, Math.max(0, s.volume))
      if (typeof s.muted === 'boolean') state.muted = s.muted
    } else if (import.meta.client) {
      // 迁移旧 localStorage
      try {
        const raw = localStorage.getItem('ai-player.player.v1')
        if (raw) {
          const old = JSON.parse(raw) as Partial<Pick<PlayerState, 'rate' | 'volume' | 'muted'>>
          if (typeof old.rate === 'number') state.rate = clampRate(old.rate)
          if (typeof old.volume === 'number') state.volume = Math.min(1, Math.max(0, old.volume))
          if (typeof old.muted === 'boolean') state.muted = old.muted
          void saveSettings()
          localStorage.removeItem('ai-player.player.v1')
        }
      } catch { /* 忽略 */ }
    }
  } catch {
    /* 忽略读取异常 */
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
  if (import.meta.client) loadSettings()

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

  async function toggleFullscreen(container: HTMLElement | null) {
    if (!container) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await container.requestFullscreen()
    } catch (err) {
      console.warn('全屏切换失败', err)
    }
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
          ? '浏览器无法解码这个视频。常见原因是 mkv/avi 使用了 Chrome 不支持的编码，可用 ffmpeg 转成 mp4（H.264 + AAC）。'
          : '视频加载失败，请检查文件是否完整。'
      state.playing = false
      state.buffering = false
    },
    fullscreenChange() {
      state.fullscreen = !!document.fullscreenElement
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
    captureFrame,
    sync,
  }
}

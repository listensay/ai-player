import { reactive } from 'vue'
import { desktopInvoke } from '~/utils/platform'
/**
 * 本机语音转文字服务（asr-server/）的客户端。
 * 服务由 Tauri 启动、管理和关闭，前端通过原生命令访问。
 */
import { nativeFileLocation } from '~/utils/desktopFiles'
import type { CourseFileHandle } from '~/types/storage'
import type { AsrHealth, AsrServiceStatus, TranscriptSegment } from '~/types/transcript'

const state = reactive({
  status: 'unknown' as AsrServiceStatus,
  health: null as AsrHealth | null,
  lastError: '',
})

let desktopStarted = false
let checking: Promise<AsrServiceStatus> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollers = 0
let starting: Promise<void> | null = null

export interface TranscribeHandlers {
  onSegment: (segment: TranscriptSegment) => void
  onProgress: (seconds: number, ratio: number | null) => void
  onQueued?: (position: number) => void
  signal?: AbortSignal
}

export interface TranscribeResult {
  duration: number
  language: string
  segments: number
  elapsed: number
}

export function useAsrService() {
  async function checkHealth(): Promise<AsrServiceStatus> {
    if (checking) return checking
    checking = readHealth().finally(() => { checking = null })
    return checking
  }

  async function startService() {
    if (starting) return starting
    starting = start().finally(() => { starting = null })
    return starting
  }
  async function start() {
    desktopStarted = true
    state.status = 'preparing'
    state.lastError = ''
    try { await desktopInvoke('asr_start'); await checkHealth() }
    catch (err) { state.status = 'error'; state.lastError = (err as Error).message }
  }

  async function waitUntilReady(signal: AbortSignal) {
    const abort = () => { throw new DOMException('已取消', 'AbortError') }
    if (signal.aborted) abort()
    if (await checkHealth() === 'offline') await startService()
    const deadline = Date.now() + 30 * 60_000
    while (!signal.aborted) {
      const status = await checkHealth()
      if (status === 'ready') return
      if (status === 'error' || status === 'offline') throw new Error(state.lastError || '本地转写服务不可用，请重试。')
      if (Date.now() > deadline) throw new Error('转写模型准备超时，请检查网络后重试。')
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
        const timer = setTimeout(finish, 1000)
        signal.addEventListener('abort', finish, { once: true })
      })
    }
    abort()
  }
  async function stopService() {
    try { await desktopInvoke('asr_stop'); state.status = 'offline'; state.health = null; state.lastError = '' }
    catch (err) { state.lastError = (err as Error).message }
  }
  async function retryService() {
    try { await desktopInvoke('asr_stop'); await startService() }
    catch (err) { state.lastError = (err as Error).message }
  }

  async function readHealth(): Promise<AsrServiceStatus> {
    try {
      const health = await desktopInvoke<AsrHealth>('asr_health')
      state.health = health
      state.lastError = health.error || ''
      state.status = health.status === 'stopped' ? 'offline' : health.status === 'ready' ? 'ready' : health.status === 'error' ? 'error' : 'preparing'
    } catch (err) {
      state.health = null
      state.status = 'offline'
      state.lastError = (err as Error).message
    }
    return state.status
  }

  /** 面板可见时每 3 秒探测一次；多个面板共享同一个定时器 */
  function startPolling() {
    pollers++
    if (!desktopStarted) void startService()
    else void checkHealth()
    if (!pollTimer) pollTimer = setInterval(() => void checkHealth(), 3000)
  }

  function stopPolling() {
    pollers = Math.max(0, pollers - 1)
    if (pollers === 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  async function transcribeHandle(handle: CourseFileHandle, duration: number, handlers: TranscribeHandlers): Promise<TranscribeResult> {
    if (handlers.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const { Channel } = await import('@tauri-apps/api/core')
    const jobId = crypto.randomUUID()
    const channel = new Channel<{ event: string; data: any }>()
    channel.onmessage = ({ event, data }) => {
      if (handlers.signal?.aborted) return
      if (event === 'segment') handlers.onSegment(data)
      else if (event === 'progress') handlers.onProgress(data.seconds, data.ratio)
      else if (event === 'queued') handlers.onQueued?.(data.position)
    }
    const cancel = () => { void desktopInvoke('asr_cancel', { jobId }).catch(() => {}) }
    handlers.signal?.addEventListener('abort', cancel, { once: true })
    try {
      await waitUntilReady(handlers.signal ?? new AbortController().signal)
      if (handlers.signal?.aborted) throw new DOMException('已取消', 'AbortError')
      return await desktopInvoke<TranscribeResult>('asr_transcribe', { ...nativeFileLocation(handle), duration: Number.isFinite(duration) ? duration : 0, jobId, onEvent: channel })
    } finally { handlers.signal?.removeEventListener('abort', cancel) }
  }

  return { state, checkHealth, startPolling, stopPolling, transcribeHandle, startService, stopService, retryService }
}

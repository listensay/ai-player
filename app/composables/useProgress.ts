import { reactive, readonly } from 'vue'
import type { VideoProgress } from '~/types/course'
import { dbFetchAllProgress, dbSaveProgress } from '~/utils/dbClient'

/**
 * 观看进度：存在 SQLite 数据库 video_progress 表中。
 * 结构：{ [courseId]: { [videoPath]: VideoProgress } }
 */
type ProgressMap = Record<string, Record<string, VideoProgress>>

export function createProgressStore(
  storage = { read: dbFetchAllProgress, write: dbSaveProgress },
  delays = { save: 400, retry: 1000 },
) {
  const state = reactive({
    map: {} as ProgressMap,
    ready: false,
    loading: false,
    saving: false,
    error: '',
    pendingCount: 0,
  })
  const pending = new Map<string, Parameters<typeof dbSaveProgress>[0]>()
  let loading: Promise<void> | undefined
  let saving: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let retryDelay = delays.retry
  let disposed = false

  function loadFromDb(): Promise<void> {
    if (state.ready) return Promise.resolve()
    if (loading) return loading
    state.loading = true
    loading = (async () => {
      try {
        state.map = await storage.read()
        state.ready = true
        state.error = ''
      } catch (error) {
        state.error = '播放进度读取失败，请重试后继续学习。'
        throw error
      } finally {
        state.loading = false
        loading = undefined
      }
    })()
    return loading
  }
  function schedule(delay: number) {
    if (timer || disposed) return
    timer = setTimeout(() => {
      timer = undefined
      void flush().catch(() => {})
    }, delay)
  }
  function flush(): Promise<void> {
    clearTimeout(timer)
    timer = undefined
    if (saving) return saving
    if (!pending.size) return Promise.resolve()
    state.saving = true
    saving = (async () => {
      try {
        while (pending.size) {
          const [key, item] = pending.entries().next().value!
          if (!(await storage.write(item))) throw new Error('播放进度保存失败，请重试。')
          // A newer edit for the same lesson must survive this write's completion.
          if (pending.get(key) === item) pending.delete(key)
          state.pendingCount = pending.size
        }
        state.error = ''
        retryDelay = delays.retry
      } catch (error) {
        state.error = '播放进度尚未保存，正在重试。'
        schedule(retryDelay)
        retryDelay = Math.min(30_000, retryDelay * 2)
        throw error
      } finally {
        state.saving = false
        saving = undefined
      }
    })()
    return saving
  }
  function scheduleSave(item: Parameters<typeof dbSaveProgress>[0]) {
    pending.set(JSON.stringify([item.courseId, item.path]), item)
    state.pendingCount = pending.size
    schedule(delays.save)
  }

  function get(courseId: string, path: string): VideoProgress | undefined {
    return state.map[courseId]?.[path]
  }

  function courseProgress(courseId: string): Record<string, VideoProgress> {
    return state.map[courseId] ?? {}
  }

  function update(courseId: string, path: string, time: number, duration: number, opts: { ended?: boolean } = {}) {
    if (!state.ready || !Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return
    const bucket = (state.map[courseId] ??= {})
    const prev = bucket[path]
    const ratio = Math.min(1, Math.max(0, time / duration))
    // Playback position alone is not completion; wait for the media ended event.
    const done = opts.ended === true || prev?.done === true
    bucket[path] = { time, duration, ratio, done, updatedAt: Date.now() }
    scheduleSave({ courseId, path, time, duration, ratio, done })
  }

  function markDone(courseId: string, path: string, done: boolean) {
    if (!state.ready) return
    const bucket = (state.map[courseId] ??= {})
    const prev = bucket[path]
    const time = done ? (prev?.duration ?? 0) : 0
    const duration = prev?.duration ?? 0
    const ratio = done ? 1 : 0
    bucket[path] = {
      time,
      duration,
      ratio,
      done,
      updatedAt: Date.now(),
    }
    scheduleSave({ courseId, path, time, duration, ratio, done })
  }

  return {
    /** 只读使用：目录等组件靠它订阅进度变化 */
    state: readonly(state),
    ready: loadFromDb,
    get,
    courseProgress,
    update,
    markDone,
    flush,
    retry: async () => {
      await loadFromDb()
      await flush()
    },
    dispose: () => {
      disposed = true
      clearTimeout(timer)
    },
  }
}

const progress = createProgressStore()
export function useProgress() {
  if (typeof window !== 'undefined' && !progress.state.ready) void progress.ready().catch(() => {})
  return progress
}

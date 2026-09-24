import { reactive, readonly } from 'vue'
import type { VideoProgress } from '~/types/course'
import { dbFetchAllProgress, dbSaveProgress } from '~/utils/dbClient'

/**
 * 观看进度：存在 SQLite 数据库 video_progress 表中。
 * 结构：{ [courseId]: { [videoPath]: VideoProgress } }
 */
const DONE_RATIO = 0.95

type ProgressMap = Record<string, Record<string, VideoProgress>>

let loading: Promise<void> | undefined
let persistTimer: ReturnType<typeof setTimeout> | null = null
const pendingSaves = new Map<string, { courseId: string; path: string; time: number; duration: number; ratio: number; done: boolean }>()

const state = reactive<{ map: ProgressMap }>({ map: {} })

function loadFromDb() {
  return loading ??= readFromDb()
}

async function readFromDb() {
  try {
    const data = await dbFetchAllProgress()
    state.map = data
  } catch (err) {
    console.warn('从 SQLite 读取进度失败', err)
  }
}

function flushPending() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  for (const item of pendingSaves.values()) {
    void dbSaveProgress(item)
  }
  pendingSaves.clear()
}

function scheduleSave(item: { courseId: string; path: string; time: number; duration: number; ratio: number; done: boolean }) {
  const key = `${item.courseId}::${item.path}`
  pendingSaves.set(key, item)
  if (!persistTimer) {
    persistTimer = setTimeout(() => {
      persistTimer = null
      flushPending()
    }, 400)
  }
}

export function useProgress() {
  if (typeof window !== 'undefined') void loadFromDb()

  function get(courseId: string, path: string): VideoProgress | undefined {
    return state.map[courseId]?.[path]
  }

  function courseProgress(courseId: string): Record<string, VideoProgress> {
    return state.map[courseId] ?? {}
  }

  function update(
    courseId: string,
    path: string,
    time: number,
    duration: number,
    opts: { ended?: boolean } = {},
  ) {
    if (!Number.isFinite(duration) || duration <= 0) return
    const bucket = (state.map[courseId] ??= {})
    const prev = bucket[path]
    const ratio = Math.min(1, Math.max(0, time / duration))
    const done = opts.ended || ratio >= DONE_RATIO || prev?.done === true
    bucket[path] = { time, duration, ratio, done, updatedAt: Date.now() }
    scheduleSave({ courseId, path, time, duration, ratio, done })
  }

  function markDone(courseId: string, path: string, done: boolean) {
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

  function flush() {
    flushPending()
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
  }
}

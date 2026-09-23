import type { VideoProgress } from '~/types/course'
import { dbFetchAllProgress, dbSaveProgress } from '~/utils/dbClient'

/**
 * 观看进度：存在 SQLite 数据库 video_progress 表中。
 * 结构：{ [courseId]: { [videoPath]: VideoProgress } }
 */
const DONE_RATIO = 0.95

type ProgressMap = Record<string, Record<string, VideoProgress>>

let loaded = false
let persistTimer: ReturnType<typeof setTimeout> | null = null
const pendingSaves = new Map<string, { courseId: string; path: string; time: number; duration: number; ratio: number; done: boolean }>()

const state = reactive<{ map: ProgressMap }>({ map: {} })

async function loadFromDb() {
  if (loaded) return
  loaded = true
  try {
    const data = await dbFetchAllProgress()
    // 兼容迁移旧 localStorage 数据
    if (import.meta.client) {
      try {
        const old = localStorage.getItem('ai-player.progress.v1')
        if (old) {
          const oldMap = JSON.parse(old) as ProgressMap
          for (const [cId, videos] of Object.entries(oldMap)) {
            if (!data[cId]) data[cId] = {}
            for (const [p, val] of Object.entries(videos)) {
              if (!data[cId]![p]) {
                data[cId]![p] = val
                void dbSaveProgress({ courseId: cId, path: p, time: val.time, duration: val.duration, ratio: val.ratio, done: val.done })
              }
            }
          }
          localStorage.removeItem('ai-player.progress.v1')
        }
      } catch { /* 忽略旧缓存解析错误 */ }
    }
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
  if (import.meta.client) void loadFromDb()

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
    get,
    courseProgress,
    update,
    markDone,
    flush,
  }
}

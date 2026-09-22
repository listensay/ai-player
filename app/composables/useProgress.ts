import type { VideoProgress } from '~/types/course'

/**
 * 观看进度：按课程 id 分组存在 localStorage。
 * 结构：{ [courseId]: { [videoPath]: VideoProgress } }
 */
const STORAGE_KEY = 'ai-player.progress.v1'
const DONE_RATIO = 0.95

type ProgressMap = Record<string, Record<string, VideoProgress>>

let cache: ProgressMap | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

const state = reactive<{ map: ProgressMap }>({ map: {} })

function load(): ProgressMap {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    cache = raw ? (JSON.parse(raw) as ProgressMap) : {}
  } catch {
    cache = {}
  }
  state.map = cache
  return cache
}

function persist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.map))
    } catch (err) {
      console.warn('进度写入 localStorage 失败', err)
    }
  }, 400)
}

export function useProgress() {
  if (import.meta.client) load()

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
    persist()
  }

  function markDone(courseId: string, path: string, done: boolean) {
    const bucket = (state.map[courseId] ??= {})
    const prev = bucket[path]
    bucket[path] = {
      time: done ? (prev?.duration ?? 0) : 0,
      duration: prev?.duration ?? 0,
      ratio: done ? 1 : 0,
      done,
      updatedAt: Date.now(),
    }
    persist()
  }

  function flush() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.map))
    } catch {
      /* 忽略 */
    }
  }

  return { state, get, courseProgress, update, markDone, flush }
}

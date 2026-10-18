import { reactive, toRaw } from 'vue'
import { isRecord } from './guide.ts'
import { validDate } from './studyProgram.ts'

export interface HomeTask {
  id: string
  title: string
  deadline: string
  createdAt: number
  completedAt: number | null
}
export type HomeTaskKind = 'todos' | 'goals'
export interface HomeTasks {
  version: 1
  todos: HomeTask[]
  goals: HomeTask[]
}

export function parseHomeTasks(value: unknown): HomeTasks {
  if (value === null || value === undefined) return { version: 1, todos: [], goals: [] }
  if (!isRecord(value) || value.version !== 1) throw Error('首页任务格式异常')
  const timestamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
  function list(kind: HomeTaskKind): HomeTask[] {
    const rows = (value as Record<string, unknown>)[kind]
    if (!Array.isArray(rows)) throw Error('首页任务格式异常')
    const ids = new Set<string>()
    return rows.map((row: unknown) => {
      if (
        !isRecord(row) ||
        typeof row.id !== 'string' ||
        !row.id ||
        ids.has(row.id) ||
        typeof row.title !== 'string' ||
        !row.title.trim() ||
        row.title.length > 240 ||
        typeof row.deadline !== 'string' ||
        (row.deadline !== '' ? !validDate(row.deadline) : kind === 'goals') ||
        !timestamp(row.createdAt) ||
        (row.completedAt !== null && !timestamp(row.completedAt))
      )
        throw Error('首页任务格式异常')
      ids.add(row.id)
      return {
        id: row.id,
        title: row.title.trim(),
        deadline: row.deadline,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
      }
    })
  }
  return { version: 1, todos: list('todos'), goals: list('goals') }
}

export function sortedHomeTasks(tasks: HomeTask[]) {
  return [...tasks].sort(
    (a, b) =>
      Number(a.completedAt !== null) - Number(b.completedAt !== null) ||
      (a.completedAt !== null && b.completedAt !== null
        ? b.completedAt - a.completedAt
        : (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31')) ||
      b.createdAt - a.createdAt,
  )
}

/** Share a single queue across page mounts; failed writes never replace committed tasks. */
export function createHomeTasks(io: { read: () => Promise<unknown>; write: (data: HomeTasks) => Promise<unknown> }) {
  const state = reactive({ data: parseHomeTasks(null), ready: false, loading: false, saving: 0, error: '' })
  let reading: Promise<void> | undefined
  let queue = Promise.resolve(true)
  function load() {
    if (state.ready) return Promise.resolve()
    if (reading) return reading
    state.loading = true
    reading = (async () => {
      try {
        state.data = parseHomeTasks(await io.read())
        state.ready = true
        state.error = ''
      } catch {
        state.error = '任务读取失败，请重试。'
      } finally {
        state.loading = false
        reading = undefined
      }
    })()
    return reading
  }
  function mutate(change: (data: HomeTasks) => void) {
    if (!state.ready) return Promise.resolve(false)
    state.saving++
    queue = queue.then(async () => {
      try {
        const next = structuredClone(toRaw(state.data))
        change(next)
        const valid = parseHomeTasks(next)
        await io.write(valid)
        state.data = valid
        state.error = ''
        return true
      } catch {
        state.error = '任务保存失败，请重试。'
        return false
      } finally {
        state.saving--
      }
    })
    return queue
  }
  return { state, load, mutate }
}

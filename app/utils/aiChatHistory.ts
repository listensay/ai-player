import { reactive, toRaw } from 'vue'
import { isRecord } from './guide.ts'
import type { AssistantSession, AssistantTurn } from '../types/learningAssistant'

export const AI_CHAT_HISTORY_KEY = 'ai-chat-history:v1'
export interface AiChatHistoryData {
  version: 1
  sessions: AssistantSession[]
}
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const id = (value: unknown): value is string => text(value, 4000) && !!value.trim()
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function parseAiChatHistory(raw: unknown, recover = false): AiChatHistoryData {
  if (raw == null) return { version: 1, sessions: [] }
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.sessions)) throw Error('对话记录格式异常')
  const ids = new Set<string>()
  const sessions = raw.sessions.map((session): AssistantSession => {
    if (
      !isRecord(session) ||
      !id(session.id) ||
      ids.has(session.id) ||
      !id(session.courseId) ||
      !id(session.path) ||
      !text(session.courseName, 4000) ||
      !text(session.videoTitle, 4000) ||
      !text(session.title, 100) ||
      !timestamp(session.createdAt) ||
      !timestamp(session.updatedAt) ||
      !Array.isArray(session.turns) ||
      !session.turns.length
    )
      throw Error('对话记录格式异常')
    ids.add(session.id)
    const turnIds = new Set<string>()
    const turns = session.turns.map((turn): AssistantTurn => {
      if (
        !isRecord(turn) ||
        !id(turn.id) ||
        turnIds.has(turn.id) ||
        !text(turn.question, 4000) ||
        !turn.question.trim() ||
        !text(turn.markdown, 2_000_000) ||
        !timestamp(turn.seconds) ||
        !text(turn.model, 4000) ||
        !text(turn.error, 12000) ||
        !['pending', 'done', 'error', 'stopped'].includes(String(turn.status))
      )
        throw Error('对话消息格式异常')
      turnIds.add(turn.id)
      return {
        id: turn.id,
        question: turn.question,
        markdown: turn.markdown,
        seconds: turn.seconds,
        model: turn.model,
        error: turn.error,
        status: recover && turn.status === 'pending' ? 'stopped' : (turn.status as AssistantTurn['status']),
      }
    })
    return {
      id: session.id,
      courseId: session.courseId,
      path: session.path,
      courseName: session.courseName,
      videoTitle: session.videoTitle,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turns,
    }
  })
  return { version: 1, sessions }
}

/** Keep unsaved snapshots in memory and serialize writes so failures and rapid video switches cannot lose chats. */
export function createAiChatHistory(io: {
  read: () => Promise<unknown>
  write: (data: AiChatHistoryData) => Promise<unknown>
}) {
  const state = reactive({ sessions: [] as AssistantSession[], ready: false, loading: false, error: '' })
  const dirty = new Map<string, AssistantSession>()
  let reading: Promise<boolean> | undefined
  let queue = Promise.resolve(true)
  function load(): Promise<boolean> {
    if (state.ready) return Promise.resolve(true)
    if (reading) return reading
    state.loading = true
    reading = (async () => {
      try {
        const saved = parseAiChatHistory(await io.read(), true)
        state.sessions = [...saved.sessions.filter((session) => !dirty.has(session.id)), ...dirty.values()]
        state.ready = true
        state.error = ''
        return true
      } catch {
        state.error = '历史对话读取失败，请重试。'
        return false
      } finally {
        state.loading = false
        reading = undefined
      }
    })()
    return reading
  }
  function write() {
    queue = queue.then(async () => {
      if (!(await load())) return false
      if (!dirty.size) return true
      const batch = new Map(dirty)
      try {
        const data = parseAiChatHistory({ version: 1, sessions: toRaw(state.sessions) })
        await io.write(data)
        for (const [id, snapshot] of batch) if (dirty.get(id) === snapshot) dirty.delete(id)
        state.error = ''
        return true
      } catch {
        state.error = '对话保存失败，请重试。'
        return false
      }
    })
    return queue
  }
  function save(session: AssistantSession) {
    const snapshot = parseAiChatHistory({ version: 1, sessions: [session] }).sessions[0]!
    dirty.set(snapshot.id, snapshot)
    state.sessions = [...state.sessions.filter((item) => item.id !== snapshot.id), snapshot]
    return write()
  }
  async function flush() {
    if (!(await write())) throw Error(state.error)
  }
  return { state, load, save, retry: write, flush }
}

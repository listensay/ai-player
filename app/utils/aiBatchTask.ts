import { databaseRequest } from '~/utils/database'
import type { GuideSettings } from '../types/guide'

type Checkpoint = { version: 1; values: unknown[] }
// Failed writes retain validated responses for retry in this session. Durable checkpoints survive restart.
const pending = new Map<string, Checkpoint>()
async function taskKey(identity: unknown) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)))
  return `ai-batches:v1:${Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, '0')).join('')}`
}
// Only consumers that have saved their final result mark a checkpoint as disposable.
export async function completeAiBatches(identity: unknown) {
  try {
    await databaseRequest('ai-batch-cache', { method: 'POST', body: { key: await taskKey(identity) } })
  } catch (error) {
    console.warn('AI 已完成批次暂未标记清理，将继续保留', error)
  }
}
export async function pruneAiBatchCache() {
  try {
    await databaseRequest('ai-batch-cache', { method: 'DELETE' })
  } catch (error) {
    console.warn('AI 缓存清理未完成，将继续保留', error)
  }
}
export function aiTaskSettings(settings: GuideSettings) {
  return {
    provider: settings.provider ?? 'openai',
    contextWindow: settings.contextWindow ?? 'default',
    baseUrl: settings.baseUrl,
    model: settings.model,
  }
}
export async function runAiBatches<B, R>(options: {
  identity: unknown
  batches: B[]
  signal: AbortSignal
  reset?: boolean
  request: (batch: B, index: number, completed: R[]) => Promise<unknown>
  validate: (raw: unknown, batch: B, index: number, completed: R[]) => R
  progress: (completed: number, total: number) => void
}): Promise<R[]> {
  const check = () => options.signal.throwIfAborted()
  check()
  const key = await taskKey(options.identity)
  // Always observe read failures; never mistake an inaccessible database for a new task.
  const stored = await databaseRequest<unknown>('settings', { query: { key } })
  check()
  let checkpoint: Checkpoint
  if (options.reset) checkpoint = { version: 1, values: [] }
  else if (pending.has(key)) checkpoint = pending.get(key)!
  else if (stored == null) checkpoint = { version: 1, values: [] }
  else {
    const value = stored as Partial<Checkpoint>
    if (value.version !== 1 || !Array.isArray(value.values) || value.values.length > options.batches.length) {
      throw new Error('AI 任务进度异常，请重新开始本次任务。')
    }
    checkpoint = { version: 1, values: [...value.values] }
  }
  const completed: R[] = []
  // Validate a restored prefix against the current material before requesting or writing anything.
  for (const [index, raw] of checkpoint.values.entries()) {
    try {
      completed.push(options.validate(raw, options.batches[index]!, index, completed))
    } catch {
      // Older validators accepted partial batches. Keep the valid prefix and redo the remainder.
      checkpoint.values = checkpoint.values.slice(0, index)
      break
    }
  }
  async function persist() {
    check()
    // Snapshot the prefix so subsequent work cannot mutate an in-flight write.
    const value = { version: 1 as const, values: [...checkpoint.values] }
    pending.set(key, value)
    try {
      await databaseRequest('settings', { method: 'POST', body: { key, value } })
    } catch {
      throw new Error('AI 批次进度保存失败，已完成结果保留在本次会话中；请重试保存后继续。')
    }
    if (pending.get(key) === value) pending.delete(key)
    check()
  }
  if (options.reset || pending.has(key)) await persist()
  options.progress(completed.length, options.batches.length)
  for (let index = completed.length; index < options.batches.length; index++) {
    check()
    const batch = options.batches[index]!
    const raw = await options.request(batch, index, completed)
    check()
    const result = options.validate(raw, batch, index, completed)
    checkpoint.values.push(raw)
    completed.push(result)
    await persist()
    options.progress(completed.length, options.batches.length)
  }
  check()
  return completed
}

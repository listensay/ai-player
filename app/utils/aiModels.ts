import type { GuideSettings } from '../types/guide'
import { aiHttpError, completionUrl } from './guideAi.ts'
import { isRecord } from './guide.ts'
import { platformFetch } from './platform.ts'

export async function fetchAiModels(settings: GuideSettings, signal: AbortSignal): Promise<string[]> {
  const provider = settings.provider ?? 'openai'
  const endpoint = completionUrl(settings.baseUrl, provider).replace(/\/(?:chat\/completions|messages)$/, '/models')
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), 30_000)
  const requestSignal = AbortSignal.any([signal, timeout.signal])
  try {
    requestSignal.throwIfAborted()
    const response = await platformFetch(endpoint, {
      signal: requestSignal,
      headers:
        provider === 'anthropic'
          ? {
              'anthropic-version': '2023-06-01',
              ...(settings.apiKey.trim() ? { 'x-api-key': settings.apiKey.trim() } : {}),
            }
          : settings.apiKey.trim()
            ? { Authorization: `Bearer ${settings.apiKey.trim()}` }
            : {},
    })
    if (!response.ok) throw aiHttpError(response.status)
    const raw: unknown = await response.json()
    requestSignal.throwIfAborted()
    if (!isRecord(raw) || !Array.isArray(raw.data)) throw new Error('服务未返回可用的模型列表。')
    const ids = [
      ...new Set(
        raw.data.flatMap((model) =>
          isRecord(model) && typeof model.id === 'string' && model.id.trim() ? [model.id.trim()] : [],
        ),
      ),
    ]
    if (!ids.length) throw new Error('服务返回的模型列表为空。')
    return ids
  } catch (error) {
    if (signal.aborted) throw new DOMException('读取已取消', 'AbortError')
    if (timeout.signal.aborted) throw new Error('读取模型列表超过 30 秒，请重试。', { cause: error })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

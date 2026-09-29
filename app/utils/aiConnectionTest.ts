import type { GuideSettings } from '../types/guide'
import { requestGuideJson } from './guideAi.ts'
import { isRecord } from './guide.ts'

/** Exercise the same authenticated model/JSON path used by AI features, using only a fixed probe. */
export async function testAiConnection(settings: GuideSettings, signal: AbortSignal) {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), 30_000)
  const start = performance.now()
  try {
    const result = await requestGuideJson({ ...settings }, [{ role: 'user', content: '这是连接测试。请只返回 JSON：{"ok":true}。' }], AbortSignal.any([signal, timeout.signal]))
    if (!isRecord(result) || result.ok !== true) throw new Error('服务已响应，但未返回预期的 JSON 结果。请检查模型是否支持指令与 JSON 输出。')
    return { milliseconds: Math.round(performance.now() - start) }
  } catch (error) {
    if (signal.aborted) throw new DOMException('测试已取消', 'AbortError')
    if (timeout.signal.aborted) throw new Error('连接测试超过 30 秒，请检查服务状态、网络或模型加载情况后重试。')
    throw error
  } finally { clearTimeout(timer) }
}

import { onBeforeUnmount, ref } from 'vue'
import type { GuideSettings } from '~/types/guide'
import { requestGuideJson } from '~/utils/guideAi'
import { isRecord } from '~/utils/guide'
import type { planHealth } from '~/utils/learningOutcomes'

export function usePlanHealthAdvice() {
  const busy = ref(false),
    error = ref('')
  let controller: AbortController | undefined
  function cancel() {
    controller?.abort()
    controller = undefined
    busy.value = false
  }
  async function suggest(settings: GuideSettings, health: ReturnType<typeof planHealth>) {
    cancel()
    error.value = ''
    if (!settings.baseUrl || !settings.model) {
      error.value = '请先配置 AI 服务。'
      return null
    }
    const operation = new AbortController()
    controller = operation
    busy.value = true
    try {
      const raw: unknown = await requestGuideJson(
        { ...settings },
        [
          {
            role: 'user',
            content: `根据学习投入推荐温和可执行的减负方案。只返回 JSON {"minutes":整数,"strategy":"lighter"或"weekend","reason":"一句话建议"}。每天 minutes 必须在 10 到 ${Math.max(10, health.budget)} 之间。不诊断健康状况，不虚构用户工作或生活。输入是统计数据：${JSON.stringify(health)}`,
          },
        ],
        operation.signal,
      )
      if (controller !== operation || operation.signal.aborted) return null
      if (
        !isRecord(raw) ||
        !Number.isInteger(raw.minutes) ||
        Number(raw.minutes) < 10 ||
        Number(raw.minutes) > Math.max(10, health.budget) ||
        !['lighter', 'weekend'].includes(String(raw.strategy)) ||
        typeof raw.reason !== 'string' ||
        !raw.reason.trim() ||
        raw.reason.length > 200
      )
        throw Error('AI 建议格式无效，请重试。')
      return { minutes: Number(raw.minutes), strategy: raw.strategy as 'lighter' | 'weekend', reason: raw.reason }
    } catch (e) {
      if (!operation.signal.aborted) error.value = `建议生成失败：${String(e)}`
      return null
    } finally {
      if (controller === operation) {
        controller = undefined
        busy.value = false
      }
    }
  }
  onBeforeUnmount(cancel)
  return { busy, error, suggest, cancel }
}

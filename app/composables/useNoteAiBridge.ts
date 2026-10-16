import { onBeforeUnmount, onMounted } from 'vue'
import type { GuideMessage, GuideSettings } from '~/types/guide'
import { desktopInvoke } from '~/utils/platform'
import { requestAiText } from '~/utils/guideAi'

interface Request {
  id: string
  prompt: string
  messages: GuideMessage[]
}

export function useNoteAiBridge(settings: GuideSettings) {
  const pending = new Map<string, AbortController>()
  const stops: Array<() => void> = []
  let disposed = false
  onMounted(async () => {
    const { listen } = await import('@tauri-apps/api/event')
    const handles = await Promise.all([
      listen<Request>('affine-ai-request', async ({ payload }) => {
        if (disposed || pending.has(payload.id)) return
        const controller = new AbortController()
        pending.set(payload.id, controller)
        try {
          if (!settings.baseUrl?.trim() || !settings.model?.trim())
            throw new Error('请先在 Study Helper 设置中选择模型')
          const text = await requestAiText({ ...settings }, payload.messages, controller.signal, payload.prompt)
          if (!controller.signal.aborted) await desktopInvoke('affine_ai_response', { id: payload.id, text })
        } catch (reason) {
          if (!controller.signal.aborted) {
            await desktopInvoke('affine_ai_response', {
              id: payload.id,
              error: reason instanceof Error ? reason.message.slice(0, 2000) : 'AI 请求失败，请重试',
            }).catch(() => {})
          }
        } finally {
          pending.delete(payload.id)
        }
      }),
      listen<string>('affine-ai-cancel', ({ payload }) => pending.get(payload)?.abort()),
    ])
    if (disposed) handles.forEach((stop) => stop())
    else stops.push(...handles)
  })
  onBeforeUnmount(() => {
    disposed = true
    stops.forEach((stop) => stop())
    pending.forEach((controller) => controller.abort())
    pending.clear()
  })
}

import { onBeforeUnmount, onMounted, ref } from 'vue'
import { desktopInvoke } from '~/utils/platform'
import { createReminderLinkConsumer, type ReminderLinkRequest } from '~/utils/reminderLinks'

export function useReminderLinks(open: (request: ReminderLinkRequest) => Promise<void>) {
  const error = ref('')
  let stopped = false,
    unlisten: (() => void) | undefined,
    starting: Promise<void> | undefined
  const consumer = createReminderLinkConsumer({
    pending: () => desktopInvoke<ReminderLinkRequest | null>('pending_reminder_link'),
    open,
    acknowledge: (token) => desktopInvoke('acknowledge_reminder_link', { token }),
    error: (message) => {
      error.value = message
    },
  })
  function retry() {
    if (starting) return starting
    starting = (async () => {
      error.value = ''
      if (!unlisten) {
        const { listen } = await import('@tauri-apps/api/event')
        const dispose = await listen('study-reminder-open', () => {
          void consumer.wake()
        })
        if (stopped) {
          dispose()
          return
        }
        unlisten = dispose
      }
      await consumer.wake()
    })()
      .catch((reason) => {
        if (!stopped) error.value = `提醒链接接收失败：${String(reason)}`
      })
      .finally(() => {
        starting = undefined
      })
    return starting
  }
  onMounted(() => {
    void retry()
  })
  onBeforeUnmount(() => {
    stopped = true
    consumer.stop()
    unlisten?.()
  })
  return { error, retry }
}

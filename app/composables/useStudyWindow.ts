import { onBeforeUnmount, onMounted, ref } from 'vue'
import { desktopInvoke } from '~/utils/platform'

export function useStudyWindow() {
  const visible = ref(false)
  let disposed = false,
    revision = 0,
    unlisten: (() => void) | undefined
  onMounted(async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      const stop = await listen<boolean>('desktop-window-visible', ({ payload }) => {
        revision++
        visible.value = payload
      })
      if (disposed) return stop()
      unlisten = stop
      const current = revision
      const value = await desktopInvoke<boolean>('desktop_window_visible')
      if (!disposed && current === revision) visible.value = value
    } catch {
      // 没有确认窗口可见时不累计实践时间。
      if (!disposed) visible.value = false
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    unlisten?.()
  })
  return visible
}

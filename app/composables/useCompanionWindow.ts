import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { desktopInvoke } from '~/utils/platform'

// Native window existence, not visibility: fullscreen temporarily hides an enabled pet.
export function useCompanionWindow(publish: () => Promise<void>, error: Ref<string>) {
  const miniOpen = ref(false)
  const opening = ref(false)
  let disposed = false
  let revision = 0
  let unlisten: (() => void) | undefined
  async function sync() {
    const current = revision
    const value = await desktopInvoke<boolean>('companion_is_open')
    if (!disposed && current === revision) miniOpen.value = value
  }
  async function change(close: boolean) {
    if (opening.value || disposed) return
    opening.value = true
    error.value = ''
    try {
      await desktopInvoke(close ? 'close_companion' : 'open_companion')
      if (disposed) return
      if (close) {
        revision++
        miniOpen.value = false
      } else {
        await sync()
        await publish()
      }
    } catch {
      error.value = close ? '桌面挂件关闭失败。' : '桌面挂件打开失败。'
    } finally {
      opening.value = false
    }
  }
  const openMini = () => change(false)
  const toggleMini = () => change(miniOpen.value)
  onMounted(async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      unlisten = await getCurrentWindow().listen<boolean>('companion-window-state', ({ payload }) => {
        revision++
        if (!disposed) miniOpen.value = payload === true
      })
      if (disposed) {
        unlisten()
        return
      }
      await sync()
    } catch {
      if (!disposed) error.value = '桌宠显示状态同步失败。'
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    unlisten?.()
  })
  return { miniOpen, opening, openMini, toggleMini }
}

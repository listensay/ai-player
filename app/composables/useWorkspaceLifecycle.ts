import { onBeforeUnmount, onMounted } from 'vue'
import { registerWorkspaceFlush } from '~/utils/workspaceFlush'
import { desktopInvoke } from '~/utils/platform'

export function useWorkspaceLifecycle(options: {
  notify: (message: string) => void
  activeJobs: () => boolean
  flush: () => Promise<void>
}) {
  let unlistenClose: (() => void) | undefined, unlistenQuit: (() => void) | undefined
  let closing = false,
    disposed = false
  async function closeSafely() {
    if (closing || disposed) return
    closing = true
    try {
      if (options.activeJobs() && !(await desktopInvoke<boolean>('confirm_asr_quit'))) return
      await options.flush()
      await desktopInvoke('finish_close')
    } catch (error) {
      options.notify(`数据尚未保存，请重试后关闭窗口：${(error as Error).message}`)
    } finally {
      closing = false
    }
  }
  const unregisterFlush = registerWorkspaceFlush(async () => {
    if (options.activeJobs()) throw Error('请先完成或取消正在进行的任务。')
    await options.flush()
  })
  onMounted(async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const { listen } = await import('@tauri-apps/api/event')
      unlistenClose = await getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault()
        void closeSafely()
      })
      unlistenQuit = await listen('desktop-quit-requested', closeSafely)
      if (disposed) {
        unlistenClose()
        unlistenQuit()
        return
      }
      await desktopInvoke('frontend_ready')
    } catch {
      options.notify('关闭窗口保护初始化失败，请稍后重试关闭。')
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    unregisterFlush()
    unlistenClose?.()
    unlistenQuit?.()
  })
}

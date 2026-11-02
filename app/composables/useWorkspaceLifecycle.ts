import { onBeforeUnmount, onMounted } from 'vue'
import { desktopInvoke } from '~/utils/platform'

export function useWorkspaceLifecycle(options: {
  notify: (message: string) => void
  activeJobs: () => boolean
  flush: () => Promise<void>
}) {
  const unlisteners: Array<() => void> = []
  let action: 'hide' | 'quit' | null = null,
    pendingQuit = false,
    disposed = false
  async function closeSafely(next: 'hide' | 'quit') {
    if (disposed) return
    if (action) {
      if (action === 'hide' && next === 'quit') pendingQuit = true
      return
    }
    action = next
    try {
      if (next === 'quit') {
        await desktopInvoke('show_main_window')
        if (options.activeJobs() && !(await desktopInvoke<boolean>('confirm_asr_quit'))) return
      }
      await options.flush()
      await desktopInvoke('notes_storage_flush')
      await desktopInvoke('data_storage_flush')
      if (!disposed) await desktopInvoke(next === 'hide' ? 'hide_main_window' : 'finish_close')
    } catch (error) {
      options.notify(`保存失败，请重试：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      action = null
      if (pendingQuit && !disposed) {
        pendingQuit = false
        void closeSafely('quit')
      }
    }
  }
  onMounted(async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      for (const [event, next] of [
        ['desktop-hide-requested', 'hide'],
        ['desktop-quit-requested', 'quit'],
      ] as const) {
        const unlisten = await listen(event, () => void closeSafely(next))
        if (disposed) {
          unlisten()
          return
        }
        unlisteners.push(unlisten)
      }
      await desktopInvoke('frontend_ready')
    } catch {
      unlisteners.splice(0).forEach((unlisten) => unlisten())
      if (!disposed) options.notify('窗口操作初始化失败，请重试。')
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    unlisteners.splice(0).forEach((unlisten) => unlisten())
  })
}

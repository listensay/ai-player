import { onBeforeUnmount, onMounted } from 'vue'
import type { Ref } from 'vue'
import type { Router } from 'vue-router'
import type { NoteEditorHandle } from '~/types/note'
import { desktopInvoke } from '~/utils/platform'

export function protectNoteNavigation(
  router: Router,
  note: Ref<NoteEditorHandle | null>,
  notify: (message: string) => void,
) {
  return router.beforeEach(async (to, from) => {
    if (to.path === from.path && to.query.lesson === from.query.lesson) return true
    try {
      await note.value?.save()
      if (note.value?.hasUnsavedChanges()) throw new Error('笔记尚未保存，请重试。')
      return true
    } catch (error) {
      notify(`无法离开当前课节：${(error as Error).message}`)
      return false
    }
  })
}

export function useWorkspaceLifecycle(options: {
  router: Router
  note: Ref<NoteEditorHandle | null>
  notify: (message: string) => void
  activeJobs: () => boolean
  flush: () => Promise<void>
}) {
  const removeGuard = protectNoteNavigation(options.router, options.note, options.notify)
  let unlistenClose: (() => void) | undefined, unlistenQuit: (() => void) | undefined
  let closing = false,
    disposed = false
  async function closeSafely() {
    if (closing || disposed) return
    closing = true
    try {
      if (options.activeJobs() && !(await desktopInvoke<boolean>('confirm_asr_quit'))) return
      await options.note.value?.save()
      if (options.note.value?.hasUnsavedChanges()) throw new Error('笔记尚未保存')
      await options.flush()
      await options.note.value?.save()
      if (options.note.value?.hasUnsavedChanges()) throw new Error('笔记有新的修改，请重试。')
      await desktopInvoke('finish_close')
    } catch (error) {
      options.notify(`数据尚未保存，请重试后关闭窗口：${(error as Error).message}`)
    } finally {
      closing = false
    }
  }
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
      options.notify('关闭窗口保护初始化失败，请先保存笔记。')
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    removeGuard()
    unlistenClose?.()
    unlistenQuit?.()
  })
}

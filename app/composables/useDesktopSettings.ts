import { onBeforeUnmount, onMounted, reactive } from 'vue'
import { desktopInvoke } from '~/utils/platform'

export function useDesktopSettings() {
  const state = reactive({ ready: false, busy: false, autostart: false, previewing: false, error: '' })
  let disposed = false
  async function load() {
    if (state.busy) return
    state.busy = true
    state.error = ''
    try {
      const enabled = await desktopInvoke<boolean>('autostart_enabled')
      if (!disposed) {
        state.autostart = enabled
        state.ready = true
      }
    } catch {
      if (!disposed) state.error = '开机自启设置读取失败，请重试。'
    } finally {
      if (!disposed) state.busy = false
    }
  }
  async function setAutostart(enabled: boolean) {
    if (!state.ready || state.busy) return
    state.busy = true
    state.error = ''
    try {
      const saved = await desktopInvoke<boolean>('set_autostart', { enabled })
      if (!disposed) state.autostart = saved
    } catch {
      if (!disposed) state.error = '开机自启设置失败，请重试。'
    } finally {
      if (!disposed) state.busy = false
    }
  }
  async function previewSound() {
    if (state.previewing) return
    state.previewing = true
    state.error = ''
    try {
      await desktopInvoke('play_reminder_sound')
    } catch {
      if (!disposed) state.error = '响铃播放失败，请重试。'
    } finally {
      if (!disposed) state.previewing = false
    }
  }
  onMounted(() => void load())
  onBeforeUnmount(() => {
    disposed = true
  })
  return { state, load, setAutostart, previewSound }
}

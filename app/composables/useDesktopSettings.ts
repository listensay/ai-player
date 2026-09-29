import { inject, onMounted, provide, reactive } from 'vue'
import type { InjectionKey } from 'vue'
import { databaseRequest } from '~/utils/database'

const KEY: InjectionKey<ReturnType<typeof provideDesktopSettings>> = Symbol('desktop-settings')
export function provideDesktopSettings() {
  const state = reactive({ autoOpenCompanion: false, ready: false, saving: false, error: '' })
  let loading: Promise<void> | undefined
  async function load() {
    if (state.ready) return
    if (loading) return loading
    loading = (async () => {
      try {
        const value = await databaseRequest<unknown>('settings', { query: { key: 'desktop-auto-open-companion' } })
        if (value !== null && typeof value !== 'boolean') throw new Error('invalid preference')
        state.autoOpenCompanion = value === true
        state.ready = true; state.error = ''
      } catch { state.error = '启动设置读取失败，请重试。' }
      finally { loading = undefined }
    })()
    return loading
  }
  async function setAutoOpenCompanion(value: boolean) {
    if (!state.ready || state.saving) return
    state.saving = true; state.error = ''
    try {
      await databaseRequest('settings', { method: 'POST', body: { key: 'desktop-auto-open-companion', value } })
      state.autoOpenCompanion = value
    } catch { state.error = '启动设置保存失败，请重试。' }
    finally { state.saving = false }
  }
  const settings = { state, load, setAutoOpenCompanion }
  provide(KEY, settings)
  onMounted(load)
  return settings
}
export function useDesktopSettings() {
  const settings = inject(KEY)
  if (!settings) throw new Error('Desktop settings provider is missing')
  return settings
}

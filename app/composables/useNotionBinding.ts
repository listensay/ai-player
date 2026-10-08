import { onBeforeUnmount, reactive, watch, type Ref } from 'vue'
import { databaseRequest } from '~/utils/database'
import { notionBindingKey, notionPageUrl, parseNotionBinding } from '~/utils/notion'

export function useNotionBinding(identity: Ref<{ courseId: string; path: string }>) {
  const state = reactive({ url: '', ready: false, saving: false, error: '' })
  let revision = 0
  async function load() {
    const token = ++revision,
      { courseId, path } = identity.value
    Object.assign(state, { url: '', ready: false, saving: false, error: '' })
    try {
      const raw = await databaseRequest('settings', { query: { key: notionBindingKey(courseId, path) } })
      if (token !== revision) return
      state.url = parseNotionBinding(raw)
      state.ready = true
    } catch (error) {
      if (token === revision) state.error = String(error)
    }
  }
  async function save(raw: string) {
    if (!state.ready || state.saving) return false
    const token = revision,
      { courseId, path } = identity.value
    state.error = ''
    state.saving = true
    try {
      const url = raw ? notionPageUrl(raw) : ''
      await databaseRequest('settings', {
        method: 'POST',
        body: { key: notionBindingKey(courseId, path), value: { version: 1, url } },
      })
      if (token !== revision) return false
      state.url = url
      return true
    } catch (error) {
      if (token === revision) state.error = String(error)
      return false
    } finally {
      if (token === revision) state.saving = false
    }
  }
  watch(
    () => notionBindingKey(identity.value.courseId, identity.value.path),
    () => void load(),
    { immediate: true, flush: 'sync' },
  )
  onBeforeUnmount(() => {
    revision++
  })
  return { state, load, save }
}

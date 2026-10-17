import { createApp, h, ref } from 'vue'
import UiButton from './components/UiButton.vue'
import { isDesktop, desktopInvoke } from './utils/platform'
import { vuetify } from './plugins/vuetify'
import { startPerformanceMeasure } from './utils/performance'
import '@fontsource-variable/plus-jakarta-sans'
import './styles/vuetify-base.scss'
import './styles/main.css'

const startupMeasure = startPerformanceMeasure('webview-ready', 0)

if (isDesktop()) {
  try {
    localStorage.removeItem('playbo-pet-position')
  } catch {
    // Storage may be unavailable; it must not prevent startup.
  }
  const failure = ref('')
  const loading = ref(false)
  const startup = createApp({
    render: () =>
      h('main', { class: 'flex h-dvh flex-col items-center justify-center gap-3 bg-page-cream text-charcoal-ink' }, [
        h('p', { role: failure.value ? 'alert' : 'status' }, failure.value || '正在打开数据…'),
        failure.value ? h(UiButton, { disabled: loading.value, onClick: openDesktop }, () => '重试') : null,
      ]),
  })
  startup.use(vuetify)
  startup.mount('#app')
  async function openDesktop() {
    if (loading.value) return
    loading.value = true
    failure.value = ''
    try {
      await desktopInvoke('initialize_data_storage')
      const { default: App } = await import('./app.vue')
      const { router } = await import('./router')
      const app = createApp(App)
      app.use(vuetify)
      app.use(router)
      await router.isReady()
      startup.unmount()
      app.mount('#app')
    } catch (error) {
      failure.value = error instanceof Error ? error.message : String(error)
    } finally {
      loading.value = false
    }
  }
  await openDesktop()
} else {
  // 前端依赖 Tauri 原生命令访问课程文件与 SQLite，不支持在浏览器中单独运行。
  createApp({
    render: () =>
      h('main', { class: 'flex h-dvh flex-col items-center justify-center gap-3 bg-page-cream text-charcoal-ink' }, [
        h('h1', { class: 'text-heading font-bold' }, 'Study Helper 仅支持桌面客户端'),
        h('p', '请通过桌面客户端打开，以访问本地课程与学习数据。'),
      ]),
  }).mount('#app')
}

startupMeasure.finish()

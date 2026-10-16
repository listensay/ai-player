import { createApp, h } from 'vue'
import { isDesktop } from './utils/platform'
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
  const { default: App } = await import('./app.vue')
  const { router } = await import('./router')
  const app = createApp(App)
  app.use(vuetify)
  app.use(router)
  await router.isReady()
  app.mount('#app')
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

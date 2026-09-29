import { createApp, h } from 'vue'
import { isDesktop } from './utils/platform'
import { vuetify } from './plugins/vuetify'
import '@fontsource-variable/plus-jakarta-sans'
import './styles/vuetify-base.scss'
import './styles/main.css'

if (isDesktop()) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  if (getCurrentWindow().label === 'companion') {
    const { default: CompanionWindow } = await import('./components/CompanionWindow.vue')
    createApp(CompanionWindow).mount('#app')
  } else {
    const { default: App } = await import('./app.vue')
    const { router } = await import('./router')
    const app = createApp(App)
    app.use(vuetify)
    app.use(router)
    await router.isReady()
    app.mount('#app')
  }
} else {
  // 前端依赖 Tauri 原生命令访问课程文件与 SQLite，不支持在浏览器中单独运行。
  createApp({ render: () => h('main', { class: 'flex h-dvh flex-col items-center justify-center gap-3 bg-page-cream text-charcoal-ink' }, [
    h('h1', { class: 'text-heading font-bold' }, 'AI Player 仅支持桌面客户端'),
    h('p', '请通过桌面客户端打开，以访问本地课程与学习数据。'),
  ]) }).mount('#app')
}

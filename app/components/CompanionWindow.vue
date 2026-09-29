<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { emitTo } from '@tauri-apps/api/event'
import { desktopInvoke } from '~/utils/platform'
import { COMPANION_ACTION_EVENT, COMPANION_STATE_EVENT, emptyCompanionSnapshot } from '~/utils/companion'
import type { CompanionAction, CompanionSnapshot } from '~/utils/companion'
import CompanionPet from './CompanionPet.vue'
import { useCompanionHitRegions } from '~/composables/useCompanionHitRegions'

const state = ref(emptyCompanionSnapshot())
const error = ref('')
const root = ref<HTMLElement>()
useCompanionHitRegions(root, () => { error.value = '桌宠点击区域同步失败。' })
const connected = ref(false)
const sending = ref(false)
let receivedAt = 0
let timer: ReturnType<typeof setInterval> | undefined
let unlisten: (() => void) | undefined
let disposed = false
async function send(type: CompanionAction['type']) {
  if (sending.value && type !== 'sync') return
  error.value = ''; sending.value = type !== 'sync'
  try { await emitTo('main', COMPANION_ACTION_EVENT, { type, lessonKey: state.value.lessonKey } satisfies CompanionAction) }
  catch { error.value = '播放器连接失败。' }
  finally { sending.value = false }
}
async function nativeDrag() {
  try { await getCurrentWindow().startDragging() } catch { error.value = '桌宠移动失败。' }
}
async function reveal() {
  try { await desktopInvoke('reveal_learning_window') }
  catch { error.value = '课程窗口打开失败。' }
}
async function close() {
  try { await getCurrentWindow().close() }
  catch { error.value = '桌宠关闭失败。' }
}
onMounted(async () => {
  try {
    unlisten = await getCurrentWindow().listen<CompanionSnapshot>(COMPANION_STATE_EVENT, ({ payload }) => {
      state.value = payload; receivedAt = Date.now(); connected.value = true
    })
    if (disposed) { unlisten(); return }
    await send('sync')
    timer = setInterval(() => {
      connected.value = Date.now() - receivedAt < 5000
      if (!connected.value) void send('sync')
    }, 2000)
  } catch { error.value = '桌宠连接失败。' }
})
onBeforeUnmount(() => { disposed = true; unlisten?.(); clearInterval(timer) })
</script>

<template>
  <main ref="root" class="desktop-pet-root" aria-label="Playbo 桌宠">
    <CompanionPet :state="state" desktop :connected="connected" :busy="sending" :error="error"
      @toggle="send('toggle')" @rest="send('rest')" @snooze="send('snooze')" @native-drag="nativeDrag" @reveal="reveal" @close="close" />
  </main>
</template>

<style>
html, body, #app { width: 100%; height: 100%; margin: 0; overflow: visible; background: transparent !important; }
body { color: #2d2c2b; font-family: 'Plus Jakarta Sans Variable', 'PingFang SC', system-ui, sans-serif; }
.desktop-pet-root { display: flex; align-items: flex-end; justify-content: center; box-sizing: border-box; width: 100%; height: 100%; min-width: 164px; min-height: 184px; padding: 12px; overflow: visible; background: transparent; }
</style>

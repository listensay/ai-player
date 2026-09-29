<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { CompanionSnapshot } from '~/utils/companion'
import PlayboMascot from './PlayboMascot.vue'
import AppIcon from './AppIcon.vue'

const props = withDefaults(defineProps<{
  state: CompanionSnapshot
  desktop?: boolean
  connected?: boolean
  busy?: boolean
  error?: string
  bubbleSide?: 'left' | 'right'
  bubbleBelow?: boolean
}>(), { connected: true, bubbleSide: 'left' })
const emit = defineEmits<{
  toggle: []
  rest: []
  snooze: []
  desktop: []
  reveal: []
  close: []
  expanded: [value: boolean]
  move: [delta: { x: number; y: number }]
  drop: []
  nativeDrag: []
  nudge: [key: string]
}>()
const root = ref<HTMLElement>()
const petButton = ref<HTMLButtonElement>()
const panelId = useId()
const expanded = ref(false)
const dismissed = ref('')
const menuOpen = ref(false)
const menu = ref<HTMLElement>()
const quiet = ref(false)
const reaction = ref('')
const reactionKey = ref(0)
let reactionTimer: ReturnType<typeof setTimeout> | undefined
let clickTimer: ReturnType<typeof setTimeout> | undefined
let greetingIndex = 0
const greetings = ['我在，陪你慢慢学。', '收到摸摸，充电成功！', '肩膀放松一下，喝口水吧。', '一点点进步，也值得开心。']
const bubbleVisible = computed(() => !menuOpen.value && (panelOpen.value || !!reaction.value || !quiet.value && props.desktop && props.state.ready))
function react() {
  reaction.value = greetings[greetingIndex++ % greetings.length]!
  reactionKey.value++
  clearTimeout(reactionTimer)
  reactionTimer = setTimeout(() => { reaction.value = '' }, 4000)
}
async function openMenu() {
  clearTimeout(clickTimer)
  menuOpen.value = true
  await nextTick()
  menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
}
function action(type: 'toggle' | 'rest' | 'snooze' | 'reveal' | 'close') {
  menuOpen.value = false
  if (type === 'toggle' && !canPlay.value) return
  if ((type === 'rest' || type === 'snooze') && (!props.connected || !props.state.ready || props.busy || props.state.blocked)) return
  switch (type) {
    case 'toggle': emit('toggle'); break
    case 'rest': emit('rest'); break
    case 'snooze': emit('snooze'); break
    case 'reveal': emit('reveal'); break
    case 'close': emit('close'); break
  }
  petButton.value?.focus()
}
function toggleQuiet() {
  quiet.value = !quiet.value
  menuOpen.value = false
  reaction.value = ''
  collapse()
  petButton.value?.focus()
}
function menuKeys(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}
const attention = computed(() => props.error || props.state.celebration || (props.state.careDue ? 'care' : ''))
const panelOpen = computed(() => expanded.value || !!attention.value && dismissed.value !== attention.value)
const canPlay = computed(() => props.connected && props.state.ready && !props.state.blocked && !props.busy)
const controlLabel = computed(() => props.state.playing ? '暂停' : props.state.restRemaining ? '提前继续' : '继续学习')
const message = computed(() => props.error || (!props.connected ? '播放器连接中。'
  : props.state.blocked ? '先完成主窗口里的操作，再回来听课。'
  : props.state.celebration || (props.state.careDue ? props.state.message : reaction.value || props.state.message)))
let pointer: { id: number; x: number; y: number; lastX: number; lastY: number; dragged: boolean } | null = null
let suppressClick = false
watch(panelOpen, open => emit('expanded', open), { immediate: true })
watch(attention, value => { if (!value) dismissed.value = '' })
function collapse() { expanded.value = false; dismissed.value = attention.value }
function activate(event: MouseEvent) {
  if (suppressClick) { suppressClick = false; return }
  clearTimeout(clickTimer)
  if (event.detail > 1) return
  clickTimer = setTimeout(react, 260)
}
function doubleClick() {
  clearTimeout(clickTimer)
  if (!suppressClick) action('toggle')
}
function pointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  suppressClick = false
  clearTimeout(clickTimer)
  menuOpen.value = false
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragged: false }
  petButton.value?.setPointerCapture(event.pointerId)
}
function pointerMove(event: PointerEvent) {
  if (!pointer || event.pointerId !== pointer.id) return
  if (!pointer.dragged && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 5) return
  pointer.dragged = true; suppressClick = true
  if (props.desktop) { pointer = null; emit('nativeDrag'); return }
  emit('move', { x: event.clientX - pointer.lastX, y: event.clientY - pointer.lastY })
  pointer.lastX = event.clientX; pointer.lastY = event.clientY
}
function pointerUp(event: PointerEvent) {
  if (petButton.value?.hasPointerCapture(event.pointerId)) petButton.value.releasePointerCapture(event.pointerId)
  if (pointer?.dragged) emit('drop')
  pointer = null
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.stopPropagation(); menuOpen.value = false; reaction.value = ''; collapse(); petButton.value?.focus()
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) { menuOpen.value = false; collapse() }
}
function blur() { menuOpen.value = false }
onMounted(() => { document.addEventListener('pointerdown', outside); window.addEventListener('blur', blur) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); clearTimeout(clickTimer); clearTimeout(reactionTimer) })
defineExpose({ collapse })
</script>

<template>
  <div ref="root" class="companion-pet" :class="{ 'is-desktop': desktop, 'bubble-right': bubbleSide === 'right', 'bubble-below': bubbleBelow }" @keydown="escape">
    <Transition name="bubble"><p v-if="bubbleVisible" :id="panelId" class="pet-bubble pet-message" :class="{ 'pet-error': error }" :role="error ? 'alert' : 'status'">{{ message }}</p></Transition>
    <div v-if="menuOpen" ref="menu" class="pet-menu" data-pet-hit="0.08" role="group" aria-label="桌宠快捷操作" @keydown="menuKeys">
      <button type="button" :disabled="!canPlay" @click="action('toggle')">{{ controlLabel }}<span>双击</span></button>
      <button type="button" :disabled="!connected || !state.ready || busy || state.blocked" @click="action('rest')">休息 3 分钟</button>
      <button v-if="state.careDue" type="button" :disabled="!connected || busy || state.blocked" @click="action('snooze')">20 分钟后提醒</button>
      <button type="button" @click="toggleQuiet">{{ quiet ? '显示日常提示' : '隐藏日常提示' }}</button>
      <button v-if="desktop" type="button" @click="action('reveal')">回到课程</button>
      <button v-if="desktop" type="button" @click="action('close')">关闭挂件</button>
    </div>
    <div class="pet-body">
      <button ref="petButton" type="button" class="pet-character" data-pet-hit="0.4" :aria-label="desktop ? 'Playbo 桌宠，点击查看，拖动移动' : 'Playbo 桌宠，点击展开，拖动或用方向键移动'" :aria-expanded="bubbleVisible" :aria-controls="bubbleVisible ? panelId : undefined" title="单击摸摸 · 双击播放/暂停 · 右键更多"
        @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @click="activate" @dblclick="doubleClick" @contextmenu.prevent="openMenu" @keydown.shift.f10.prevent="openMenu"
        @keydown.up.prevent="emit('nudge', 'up')" @keydown.down.prevent="emit('nudge', 'down')" @keydown.left.prevent="emit('nudge', 'left')" @keydown.right.prevent="emit('nudge', 'right')">
        <span :key="reactionKey" class="pet-art" :class="{ 'is-petted': reaction }"><PlayboMascot :mood="reaction && !state.careDue && !state.restRemaining ? 'celebrate' : state.mood" :size="desktop ? 148 : 128" /></span>
      </button>
      <button v-if="desktop" type="button" class="pet-dismiss pet-icon-button" data-pet-hit="0.5" aria-label="关闭桌宠" title="关闭桌宠，课程继续播放" @click="emit('close')"><AppIcon name="close" :size="14" /></button>
      <button v-else type="button" class="pet-detach pet-icon-button" aria-label="放到桌面" title="放到桌面" :disabled="busy" @click="emit('desktop')"><AppIcon name="pip" :size="16" /></button>
      <div class="pet-name">
        <button v-if="desktop && state.ready" type="button" class="pet-quick-play" data-pet-hit="0.5" :aria-label="controlLabel" :disabled="!canPlay" @click="emit('toggle')"><AppIcon :name="state.playing ? 'pause' : 'play'" :size="13" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.companion-pet { position: relative; width: 144px; height: 164px; pointer-events: none; color: #2d2c2b; font-size: 12px; }
.companion-pet.is-desktop { width: 164px; height: 184px; }
.pet-body { position: absolute; right: 0; bottom: 0; width: 100%; }
.pet-character { display: block; margin: 0 auto; padding: 0; border: 0; background: transparent; cursor: grab; touch-action: none; pointer-events: auto; filter: drop-shadow(0 3px 3px #2d2c2b24); border-radius: 40%; }
.pet-character:active { cursor: grabbing; }
.pet-character:focus-visible { outline: 2px solid #0061ef; outline-offset: 2px; }
.pet-name { display: flex; justify-content: center; align-items: center; gap: 4px; margin-top: -3px; }
.pet-quick-play { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 24px; padding: 3px 9px; border: 1px solid #e2ded9; border-radius: 20px; background: #fffaf3; font-size: 10px; font-weight: 750; box-shadow: 0 2px 5px #2d2c2b0d; }
.pet-quick-play { width: 26px; padding: 3px; background: #ffce00; border-color: #ffce00; }
.pet-bubble { position: absolute; bottom: calc(100% + 8px); right: 0; box-sizing: border-box; width: max-content; max-width: min(280px, calc(100vw - 24px)); max-height: min(300px, calc(100dvh - 200px)); overflow-y: auto; padding: 10px 14px; border: 1px solid #e2ded9; border-radius: 22px 22px 12px 22px; background: #fffaf3; box-shadow: 0 5px 20px #2d2c2b15; pointer-events: auto; }
.bubble-right .pet-bubble { right: auto; left: 0; border-radius: 22px 22px 22px 12px; }
.bubble-below .pet-bubble { bottom: auto; top: calc(100% + 8px); }
.is-desktop .pet-bubble { left: 50%; right: auto; bottom: calc(100% - 28px); transform: translateX(-50%); max-width: calc(100vw - 24px); max-height: 160px; border-radius: 18px; text-align: center; pointer-events: none; }
.pet-icon-button { display: inline-grid; place-items: center; width: 26px; height: 26px; flex-shrink: 0; padding: 0; border-radius: 50%; border: 1px solid #e2ded9; background: #fffaf3; }
.pet-dismiss, .pet-detach { position: absolute; top: 16px; right: 0; opacity: 0; visibility: hidden; transition: opacity .15s; }
.companion-pet:hover .pet-dismiss, .companion-pet:focus-within .pet-dismiss, .companion-pet:hover .pet-detach, .companion-pet:focus-within .pet-detach { opacity: 1; visibility: visible; }
.pet-message { margin: 0; font-size: 12px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.pet-error { color: #b3261e; }
button { color: inherit; cursor: pointer; pointer-events: auto; font-family: inherit; }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible { outline: 2px solid #0061ef; outline-offset: 2px; }
.pet-art { display: block; transition: transform .2s ease; transform-origin: 50% 85%; }
.pet-character:hover .pet-art { transform: translateY(-4px) rotate(-3deg); }
.pet-character:active .pet-art { transform: scale(.94, 1.04) rotate(4deg); }
.pet-art.is-petted { animation: pet-wiggle .55s ease; }
.pet-menu { position: absolute; right: 0; bottom: calc(100% + 8px); width: 196px; padding: 6px; box-sizing: border-box; border: 1px solid #e2ded9; border-radius: 16px; background: #fff; box-shadow: 0 5px 20px #2d2c2b15; pointer-events: auto; }
.is-desktop .pet-menu { left: 50%; right: auto; bottom: calc(100% - 24px); transform: translateX(-50%); }
.pet-menu button { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 34px; padding: 7px 10px; border: 0; border-radius: 10px; background: transparent; text-align: left; font-size: 12px; }
.pet-menu button:hover:not(:disabled), .pet-menu button:focus-visible { background: #ffce0026; }
.pet-menu button span { color: #63605d; font-size: 10px; }
.bubble-enter-active, .bubble-leave-active { transition: opacity .18s ease, transform .18s ease; }
.bubble-enter-from, .bubble-leave-to { opacity: 0; transform: translateY(5px); }
.is-desktop .bubble-enter-from, .is-desktop .bubble-leave-to { transform: translate(-50%, 5px); }
@keyframes pet-wiggle { 0%, 100% { rotate: 0deg; } 25% { rotate: -8deg; } 65% { rotate: 6deg; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>

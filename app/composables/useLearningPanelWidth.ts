import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

const STORAGE = 'learning-panel-width:v1'
export function useLearningPanelWidth(panel: Ref<HTMLElement | null>) {
  const width = ref(480),
    customized = ref(false),
    dragging = ref(false)
  let startX = 0,
    startWidth = 0
  const style = computed(() => (customized.value ? { '--learning-panel-width': `min(${width.value}px, 60vw)` } : {}))
  function save() {
    try {
      localStorage.setItem(STORAGE, String(width.value))
    } catch {
      /* Resizing still works without storage. */
    }
  }
  function update(value: number) {
    width.value = Math.round(Math.max(320, Math.min(900, value)))
    customized.value = true
  }
  function move(event: PointerEvent) {
    if (dragging.value) update(startWidth + startX - event.clientX)
  }
  function finish() {
    if (!dragging.value) return
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    save()
  }
  function start(event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    startX = event.clientX
    startWidth = panel.value?.getBoundingClientRect().width ?? width.value
    dragging.value = true
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  function keydown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const current = panel.value?.getBoundingClientRect().width ?? width.value
    update(event.key === 'Home' ? 320 : event.key === 'End' ? 900 : current + (event.key === 'ArrowLeft' ? 24 : -24))
    save()
  }
  onMounted(() => {
    try {
      const raw = localStorage.getItem(STORAGE),
        value = Number(raw)
      if (raw && Number.isFinite(value) && value >= 320 && value <= 900) update(value)
    } catch {
      /* Use the responsive default width. */
    }
  })
  onBeforeUnmount(finish)
  return { width, style, dragging, start, keydown }
}

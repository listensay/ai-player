import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

type Side = 'left' | 'right'
const CLOSE_WIDTH = 80
const VIDEO_MIN_WIDTH = 240
const STORAGE = { left: 'player-directory-width:v1', right: 'learning-panel-width:v1' }

export function usePlayerPanels(
  layout: Ref<HTMLElement | null>,
  directory: Ref<HTMLElement | null>,
  learning: Ref<HTMLElement | null>,
  directoryOpen: Ref<boolean>,
  learningOpen: Ref<boolean>,
) {
  const requested = { left: ref<number | null>(null), right: ref<number | null>(null) }
  const elements = { left: directory, right: learning }
  const open = { left: directoryOpen, right: learningOpen }
  const layoutWidth = ref(0),
    wide = ref(false),
    dragging = ref<Side | null>(null)
  let observer: ResizeObserver | undefined,
    handle: HTMLElement | null = null,
    pointerId = 0,
    startX = 0,
    startWidth = 0

  const available = computed(() => {
    const count = Number(directoryOpen.value) + Number(learningOpen.value)
    return Math.max(0, layoutWidth.value - 32 - count * 16 - VIDEO_MIN_WIDTH)
  })
  const widths = computed(() => {
    const left = directoryOpen.value ? (requested.left.value ?? (wide.value ? 300 : 280)) : 0
    const right = learningOpen.value ? (requested.right.value ?? (wide.value ? 440 : 400)) : 0
    const scale = layoutWidth.value && left + right ? Math.min(1, available.value / (left + right)) : 1
    return { left: Math.floor(left * scale), right: Math.floor(right * scale) }
  })
  const style = computed(() => ({
    '--directory-width': `${widths.value.left}px`,
    '--learning-panel-width': `${widths.value.right}px`,
  }))

  function save(side: Side) {
    try {
      localStorage.setItem(STORAGE[side], String(requested[side].value))
    } catch {
      /* Resizing still works without storage. */
    }
  }
  function finish(event?: PointerEvent) {
    if (!dragging.value || (event && event.pointerId !== pointerId)) return
    const side = dragging.value
    dragging.value = null
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    window.removeEventListener('blur', stop)
    if (handle?.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
    handle = null
    save(side)
  }
  function stop() {
    finish()
  }
  function maxWidth(side: Side) {
    return Math.max(0, available.value - widths.value[side === 'left' ? 'right' : 'left'])
  }
  function update(side: Side, value: number, restoreWidth: number) {
    if (value <= CLOSE_WIDTH) {
      // Reopening restores the width before this gesture, not the nearly closed sliver.
      requested[side].value = restoreWidth
      finish()
      open[side].value = false
    } else {
      requested[side].value = Math.round(Math.min(maxWidth(side), value))
    }
  }
  function move(event: PointerEvent) {
    if (!dragging.value || event.pointerId !== pointerId) return
    const side = dragging.value
    update(side, startWidth + (event.clientX - startX) * (side === 'left' ? 1 : -1), startWidth)
  }
  function snapshot() {
    for (const side of ['left', 'right'] as const) {
      if (open[side].value)
        requested[side].value = elements[side].value?.getBoundingClientRect().width ?? widths.value[side]
    }
  }
  function start(side: Side, event: PointerEvent) {
    if (event.button !== 0 || dragging.value) return
    event.preventDefault()
    snapshot()
    startX = event.clientX
    startWidth = requested[side].value ?? widths.value[side]
    pointerId = event.pointerId
    handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(pointerId)
    dragging.value = side
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', stop)
  }
  function keydown(side: Side, event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    snapshot()
    const current = requested[side].value ?? widths.value[side]
    const delta = (event.key === 'ArrowRight' ? 24 : -24) * (side === 'left' ? 1 : -1)
    update(side, event.key === 'Home' ? 0 : event.key === 'End' ? maxWidth(side) : current + delta, current)
    save(side)
  }
  function measure() {
    layoutWidth.value = layout.value?.getBoundingClientRect().width ?? 0
    wide.value = window.innerWidth >= 1280
  }
  function observe() {
    observer?.disconnect()
    measure()
    if (layout.value) observer?.observe(layout.value)
  }
  watch(layout, observe, { flush: 'post' })
  onMounted(() => {
    for (const side of ['left', 'right'] as const) {
      try {
        const raw = localStorage.getItem(STORAGE[side]),
          value = Number(raw)
        if (raw && Number.isFinite(value) && value > CLOSE_WIDTH) requested[side].value = value
      } catch {
        /* Use the responsive default width. */
      }
    }
    observer = new ResizeObserver(measure)
    observe()
    window.addEventListener('resize', measure)
  })
  onBeforeUnmount(() => {
    stop()
    observer?.disconnect()
    window.removeEventListener('resize', measure)
  })
  const panel = (side: Side) => ({
    width: computed(() => widths.value[side]),
    maxWidth: computed(() => maxWidth(side)),
    start: (event: PointerEvent) => start(side, event),
    keydown: (event: KeyboardEvent) => keydown(side, event),
  })
  return { directory: panel('left'), learning: panel('right'), style, dragging }
}

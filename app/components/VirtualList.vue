<script setup lang="ts" generic="T">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { VirtualListHandle } from '~/types/virtualList'
import { VVirtualScroll } from 'vuetify/components'
const props = withDefaults(
  defineProps<{
    items: T[]
    itemKey: (item: T) => string | number
    itemHeight?: number
    active?: boolean
  }>(),
  { itemHeight: 40, active: true },
)
const emit = defineEmits<{ interact: [] }>()
const virtual = ref<InstanceType<typeof VVirtualScroll>>()
let generation = 0,
  disposed = false
const frames = new Map<number, () => void>()
const element = () => virtual.value?.$el as HTMLElement | undefined
const frame = () =>
  new Promise<void>((resolve) => {
    const id = requestAnimationFrame(() => {
      frames.delete(id)
      resolve()
    })
    frames.set(id, resolve)
  })
function interrupt() {
  generation++
  emit('interact')
}
const keyOf = (item: unknown) => props.itemKey(item as T)
function onPointerDown(event: PointerEvent) {
  if (event.target === element()) interrupt()
}
function onKeydown(event: KeyboardEvent) {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) interrupt()
}
async function scrollToIndex(index: number, align: 'start' | 'center' | 'nearest' = 'start', smooth = false) {
  const revision = ++generation
  await nextTick()
  const list = element()
  if (
    disposed ||
    revision !== generation ||
    !props.active ||
    !list?.clientHeight ||
    index < 0 ||
    index >= props.items.length
  )
    return
  if (!list.querySelector(`[data-virtual-index="${index}"]`)) virtual.value?.scrollToIndex(index)
  // Allow variable-height rows to be measured, then correct only this scroll container.
  for (let attempt = 0; attempt < 4; attempt++) {
    await frame()
    await nextTick()
    if (disposed || revision !== generation || !props.active || !list.clientHeight) return
    const row = list.querySelector<HTMLElement>(`[data-virtual-index="${index}"]`)
    if (!row) continue
    const bounds = row.getBoundingClientRect(),
      viewport = list.getBoundingClientRect()
    const top = bounds.top - viewport.top - list.clientTop
    const delta =
      align === 'center'
        ? top - (list.clientHeight - bounds.height) / 2
        : align === 'nearest'
          ? top < 0
            ? top
            : Math.max(0, top + bounds.height - list.clientHeight)
          : top
    if (Math.abs(delta) < 1) return
    list.scrollTo({ top: list.scrollTop + delta, behavior: smooth ? 'smooth' : 'auto' })
    if (smooth) return
  }
}
watch(
  () => props.items,
  () => {
    generation++
  },
)
watch(
  () => props.active,
  (active) => {
    if (active) nextTick(() => virtual.value?.calculateVisibleItems())
    else generation++
  },
)
onBeforeUnmount(() => {
  disposed = true
  generation++
  for (const [id, resolve] of frames) {
    cancelAnimationFrame(id)
    resolve()
  }
  frames.clear()
})
defineExpose({ scrollToIndex, element } satisfies VirtualListHandle)
</script>
<template>
  <VVirtualScroll
    ref="virtual"
    class="scroll-soft min-h-0"
    :items="items"
    :item-key="keyOf"
    :item-height="itemHeight"
    role="list"
    @wheel.passive="interrupt"
    @touchmove.passive="interrupt"
    @pointerdown="onPointerDown"
    @keydown="onKeydown"
  >
    <template #default="{ item, index }">
      <div :data-virtual-index="index" role="listitem" :aria-posinset="index + 1" :aria-setsize="items.length">
        <slot :item="item" :index="index" />
      </div>
    </template>
  </VVirtualScroll>
</template>

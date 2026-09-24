<script setup lang="ts">
import { onBeforeUnmount, computed, ref, watch } from 'vue'
import { PLAYBACK_RATES } from '~/composables/usePlayer'
/** 倍速选择：药丸按钮 + 白色浮层菜单 */
const props = defineProps<{ rate: number }>()
const emit = defineEmits<{ change: [rate: number] }>()

const open = ref(false)
const rootEl = ref<HTMLElement>()

const label = computed(() => `${Number(props.rate.toFixed(2))}x`)

function pick(rate: number) {
  emit('change', rate)
  open.value = false
}

function onDocumentClick(e: MouseEvent) {
  if (!rootEl.value?.contains(e.target as Node)) open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

watch(open, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDocumentClick)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('mousedown', onDocumentClick)
    document.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      class="tabular inline-flex h-8 min-w-14 items-center justify-center rounded-full border border-linen bg-pure-white px-3 text-body-sm font-bold text-charcoal-ink transition-colors hover:bg-cream-deep"
      :aria-expanded="open"
      aria-haspopup="listbox"
      title="播放速度（[ 减速，] 加速）"
      @click="open = !open"
    >
      {{ label }}
    </button>

    <ul
      v-if="open"
      role="listbox"
      aria-label="播放速度"
      class="absolute right-0 bottom-full z-20 mb-2 flex w-36 flex-col gap-0.5 rounded-xl bg-pure-white p-1.5 shadow-float"
    >
      <li v-for="r in PLAYBACK_RATES" :key="r">
        <button
          type="button"
          role="option"
          :aria-selected="Math.abs(r - rate) < 0.001"
          class="tabular flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-body-sm font-medium transition-colors hover:bg-cream-deep"
          :class="Math.abs(r - rate) < 0.001 ? 'bg-page-cream font-bold' : ''"
          @click="pick(r)"
        >
          <span>{{ r }}x</span>
          <span
            v-if="Math.abs(r - rate) < 0.001"
            class="h-2 w-2 rounded-full bg-sunbeam-yellow ring-2 ring-charcoal-ink"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>
  </div>
</template>

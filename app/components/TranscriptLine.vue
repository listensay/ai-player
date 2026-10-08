<script setup lang="ts">
import type { TranscriptMatch, TranscriptSegment } from '~/types/transcript'
import { formatTime } from '~/utils/time'
import { splitByRanges } from '~/utils/transcript'
defineProps<{
  seg: TranscriptSegment
  index: number
  active: boolean
  ranges?: TranscriptMatch['ranges']
  virtual?: boolean
}>()
const emit = defineEmits<{ seek: [seconds: number]; quote: [segment: TranscriptSegment] }>()
</script>
<template>
  <component
    :is="virtual ? 'div' : 'li'"
    :data-index="index"
    class="group flex gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-100 ease-soft"
    :class="active ? 'bg-sunbeam-yellow/25' : 'hover:bg-cream-deep'"
  >
    <button
      type="button"
      class="tabular mt-0.5 h-6 shrink-0 rounded-full px-2 text-caption font-bold transition-colors inline-flex items-center gap-1"
      :class="active ? 'bg-charcoal-ink text-pure-white' : 'bg-page-cream text-graphite group-hover:bg-linen'"
      :title="seg.refined ? `跳转至 ${formatTime(seg.start)}（AI 已校对）` : `跳转至 ${formatTime(seg.start)}`"
      @click="emit('seek', seg.start)"
    >
      <span>{{ formatTime(seg.start) }}</span>
      <span v-if="seg.refined" class="h-1.5 w-1.5 rounded-full bg-mindful-blue" title="AI 已校对修正" />
    </button>
    <button
      type="button"
      class="min-w-0 flex-1 text-left text-body-sm leading-relaxed"
      :class="active ? 'text-charcoal-ink' : 'text-graphite'"
      @click="emit('seek', seg.start)"
    >
      <template v-for="(part, i) in splitByRanges(seg.text, ranges)" :key="i">
        <mark v-if="part.hit" class="rounded-sm bg-sunbeam-yellow px-0.5 text-charcoal-ink">{{ part.text }}</mark>
        <template v-else>{{ part.text }}</template>
      </template>
    </button>
    <button
      type="button"
      class="mt-0.5 h-6 shrink-0 rounded-full px-2 text-caption font-medium text-stone opacity-0 transition-opacity hover:bg-linen hover:text-charcoal-ink focus-visible:opacity-100 group-hover:opacity-100"
      title="复制本句与时间戳"
      @click="emit('quote', seg)"
    >
      复制
    </button>
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { StageProgress } from '~/utils/studyProgram'

/** 阶段进度分三项展示：视频已看、练习验收、项目验收。 */
const props = defineProps<{ progress: StageProgress; inline?: boolean }>()
const rows = computed(() => [
  { label: '视频已看', item: props.progress.video },
  { label: '练习验收', item: props.progress.exercise },
  { label: '项目验收', item: props.progress.project },
])
const percent = (done: number, total: number) => total ? `${Math.round((done / total) * 100)}%` : '0%'
</script>

<template>
  <dl class="grid min-w-0 gap-x-4 gap-y-2" :class="inline ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1'">
    <div v-for="row in rows" :key="row.label" class="min-w-0">
      <div class="flex items-baseline justify-between gap-2 text-caption">
        <dt class="truncate text-stone">{{ row.label }}</dt>
        <dd class="tabular shrink-0 font-bold text-charcoal-ink">{{ row.item.total ? `${row.item.done}/${row.item.total}` : '未设置' }}</dd>
      </div>
      <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-linen" aria-hidden="true">
        <div class="h-full rounded-full bg-charcoal-ink transition-all duration-300" :style="{ width: percent(row.item.done, row.item.total) }" />
      </div>
    </div>
  </dl>
</template>

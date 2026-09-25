<script setup lang="ts">
import { useGuide } from '~/composables/useLearningGuide'
import type { WorkEntry } from '~/types/guide'
import { WORK_LABELS, formatMinutes } from '~/utils/studyProgram'

/** 今日实践任务：记录投入时间与成果，完成后自动顺延同类下一项任务。 */
const guide = useGuide()
function repeat(entry: WorkEntry) {
  return !!guide.moduleMap.value.get(entry.moduleId)?.practice?.tasks.find(t => t.id === entry.taskId)?.repeat
}
function setMinutes(entry: WorkEntry, event: Event) {
  const input = event.target as HTMLInputElement
  if (!guide.updateWork(entry.id, { minutes: Number(input.value) })) input.value = String(entry.minutes)
}
</script>

<template>
  <ul class="space-y-2.5" aria-label="今日实践任务">
    <li v-for="entry in guide.todayWork.value" :key="entry.id" :data-work-id="entry.id" class="rounded-xl border border-linen bg-pure-white p-3">
      <div class="flex items-start gap-3">
        <VCheckbox class="shrink-0" :model-value="entry.done" :aria-label="`${repeat(entry) ? '完成今日任务' : '完成任务'}：${entry.title}`"
          @update:model-value="guide.updateWork(entry.id, { done: !!$event })" />
        <div class="min-w-0 flex-1">
          <p class="text-caption text-stone">{{ WORK_LABELS[entry.kind] }} · 计划 {{ formatMinutes(entry.targetMinutes) }}{{ repeat(entry) ? ' · 每日任务' : '' }}</p>
          <p class="mt-0.5 text-body-sm font-bold leading-relaxed [overflow-wrap:anywhere]" :class="entry.done ? 'text-stone line-through' : 'text-charcoal-ink'">{{ entry.title }}</p>
          <VExpansionPanels class="my-3">
            <VExpansionPanel value="content">
              <VExpansionPanelTitle>操作要求</VExpansionPanelTitle>
              <VExpansionPanelText>
                <p class="mt-1 leading-relaxed [overflow-wrap:anywhere]">{{ entry.instructions }}</p>
              </VExpansionPanelText>
            </VExpansionPanel>
          </VExpansionPanels>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-caption">
            <label class="flex shrink-0 items-center gap-1.5 text-stone">已投入
              <VTextField type="number" min="0" max="1440" step="5" :model-value="entry.minutes" :aria-label="`${entry.title} 已投入分钟数`"
                class="w-16 text-center" @change="setMinutes(entry, $event)" />分钟
            </label>
            <VTextField type="text" maxlength="6000" :model-value="entry.evidence" :aria-label="`${entry.title} 成果记录`" placeholder="成果记录：提交链接、完成内容或遇到的问题"
              class="min-w-0 flex-1 basis-48"
              @change="guide.updateWork(entry.id, { evidence: ($event.target as HTMLInputElement).value })" />
          </div>
        </div>
      </div>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { GuideLesson, MasteryLevel } from '~/types/guide'
import { lessonConcepts, masteryKey, MASTERY_LABELS } from '~/utils/learningFeedback'
defineProps<{ lesson: GuideLesson }>()
const guide = useGuide()
function change(path: string, concept: string, event: Event) {
  guide.setMastery(path, concept, (event.target as HTMLSelectElement).value as MasteryLevel | '')
}
</script>

<template>
  <fieldset class="mt-3 space-y-2 rounded-xl bg-page-cream p-3">
    <legend class="px-1 text-caption text-stone">我的掌握程度</legend>
    <label v-for="concept in lessonConcepts(lesson)" :key="concept" class="flex items-center justify-between gap-3 text-caption">
      <span class="min-w-0 break-words">{{ concept }}</span>
      <select :value="guide.state.mastery[masteryKey(lesson.path, concept)]?.level ?? ''"
        :aria-label="`${guide.videoMap.value.get(lesson.path)?.title} · ${concept} 掌握程度`" :disabled="!!guide.state.busy"
        class="shrink-0 rounded-full border border-linen bg-pure-white px-2 py-1.5" @change="change(lesson.path, concept, $event)">
        <option value="">未标记</option>
        <option v-for="(label, level) in MASTERY_LABELS" :key="level" :value="level">{{ label }}</option>
      </select>
    </label>
  </fieldset>
</template>

<script setup lang="ts">
import { useGuide } from '~/composables/useLearningGuide'
import type { GuideLesson, MasteryLevel } from '~/types/guide'
import { lessonConcepts, masteryKey, MASTERY_LABELS } from '~/utils/learningFeedback'
defineProps<{ lesson: GuideLesson }>()
const guide = useGuide()
const items = [{ title: '未标记', value: '' }, ...Object.entries(MASTERY_LABELS).map(([value, title]) => ({ title, value }))]
function change(path: string, concept: string, value: string) {
  guide.setMastery(path, concept, value as MasteryLevel | '')
}
</script>

<template>
  <fieldset class="mt-3 space-y-2 rounded-xl bg-page-cream p-3">
    <legend class="px-1 text-caption text-stone">知识掌握程度</legend>
    <div v-for="concept in lessonConcepts(lesson)" :key="concept" class="flex flex-wrap items-center justify-between gap-3 text-caption">
      <span class="min-w-0 break-words">{{ concept }}</span>
      <VSelect :model-value="guide.state.mastery[masteryKey(lesson.path, concept)]?.level ?? ''" :items="items"
        :aria-label="`${guide.videoMap.value.get(lesson.path)?.title} · ${concept} 掌握程度`" :disabled="!!guide.state.busy"
        class="w-36 max-w-40 flex-none" @update:model-value="change(lesson.path, concept, $event ?? '')" />
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import { useGuide } from '~/composables/useLearningGuide'
import UiButton from '~/components/UiButton.vue'
import type { TodayItem } from '~/types/guide'

const guide = useGuide()
const emit = defineEmits<{ segment: [item: TodayItem] }>()
function start() {
  const item = guide.continueNextDay()
  if (item) emit('segment', item)
}
</script>

<template>
  <div v-if="guide.nextStudy.value" class="space-y-2">
    <UiButton size="sm" variant="dark" @click="start">继续学习下一天</UiButton>
    <p class="text-caption leading-relaxed text-stone">
      提前学习 {{ guide.nextStudy.value.date }} 的课程，用时计入今天。
    </p>
  </div>
</template>

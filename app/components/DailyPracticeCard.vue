<script setup lang="ts">
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import UiButton from '~/components/UiButton.vue'
import { computed } from 'vue'
defineProps<{ compact?: boolean }>()
const { daily, openDailyPractice } = useCourseWorkspace()
const score = computed(() => daily.records.value[0]?.attempts.at(-1)?.feedback.grade?.score)
const status = computed(() =>
  score.value !== undefined
    ? `作业评分 ${score.value} / 100`
    : daily.finished.value
      ? '综合练习已完成'
      : daily.records.value.length
        ? '综合应用作业待提交'
        : daily.complete.value
          ? '今日安排已完成，可开始综合练习'
          : `视频任务 ${daily.items.value.filter((i) => i.done).length} / ${daily.items.value.length}`,
)
const compactStatus = computed(() =>
  daily.state.error
    ? '提示'
    : score.value !== undefined
      ? `${score.value} 分`
      : daily.finished.value
        ? '已完成'
        : daily.records.value.length
          ? '继续'
          : daily.complete.value
            ? '开始'
            : `${daily.items.value.filter((i) => i.done).length}/${daily.items.value.length}`,
)
</script>

<template>
  <section
    v-if="daily.items.value.length"
    aria-label="今日巩固"
    :class="
      compact
        ? 'shrink-0'
        : 'flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-linen bg-sunbeam-yellow/15 p-4'
    "
  >
    <UiButton
      v-if="compact"
      variant="ghost"
      size="sm"
      class="daily-practice-compact"
      aria-label="打开今日巩固"
      :title="daily.state.error || status"
      :disabled="!daily.complete.value"
      @click="openDailyPractice"
    >
      <span>今日巩固</span>
      <span class="font-normal" :class="daily.state.error ? 'text-error' : 'text-stone'">{{ compactStatus }}</span>
    </UiButton>
    <template v-else>
      <div class="min-w-0">
        <h3 class="text-body-sm font-bold">今日巩固</h3>
        <p class="mt-1 text-caption text-stone">{{ status }}</p>
      </div>
      <UiButton class="shrink-0" size="sm" :disabled="!daily.complete.value" @click="openDailyPractice">{{
        score !== undefined
          ? '查看评分'
          : daily.finished.value
            ? '查看结果'
            : daily.records.value.length
              ? '继续作业'
              : '开始巩固'
      }}</UiButton>
    </template>
    <p v-if="daily.state.error" role="alert" :class="compact ? 'sr-only' : 'w-full text-caption text-error'">
      {{ daily.state.error }}
    </p>
  </section>
</template>

<style scoped>
.daily-practice-compact.ui-button.v-btn {
  height: 32px;
  padding-inline: 12px;
  font-size: var(--text-caption);
}
.daily-practice-compact :deep(.v-btn__content) {
  gap: 8px;
}
</style>

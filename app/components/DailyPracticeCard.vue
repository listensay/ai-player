<script setup lang="ts">
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import UiButton from '~/components/UiButton.vue'
import { computed } from 'vue'
const { daily, openDailyPractice } = useCourseWorkspace()
const score = computed(() => daily.records.value[0]?.attempts.at(-1)?.feedback.grade?.score)
</script>

<template>
  <section
    v-if="daily.items.value.length"
    aria-label="今日巩固"
    class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-linen bg-sunbeam-yellow/15 p-4"
  >
    <div>
      <h3 class="text-body-sm font-bold">今日巩固</h3>
      <p class="mt-1 text-caption text-stone">
        {{
          score !== undefined
            ? `作业评分 ${score} / 100`
            : daily.finished.value
              ? '综合练习已完成'
              : daily.records.value.length
                ? '综合应用作业待提交'
                : daily.complete.value
                  ? '今日计划视频已学完，可开始综合练习'
                  : `视频任务 ${daily.items.value.filter((i) => i.done).length} / ${daily.items.value.length}`
        }}
      </p>
    </div>
    <UiButton size="sm" :disabled="!daily.complete.value" @click="openDailyPractice">{{
      score !== undefined
        ? '查看评分'
        : daily.finished.value
          ? '查看结果'
          : daily.records.value.length
            ? '继续作业'
            : '开始巩固'
    }}</UiButton>
    <p v-if="daily.state.error" role="alert" class="w-full text-caption text-error">{{ daily.state.error }}</p>
  </section>
</template>

<script setup lang="ts">
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import UiButton from '~/components/UiButton.vue'
const { daily, openDailyPractice } = useCourseWorkspace()
</script>

<template>
  <section v-if="daily.items.value.length" aria-label="今日巩固" class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-linen bg-sunbeam-yellow/15 p-4">
    <div>
      <h3 class="text-body-sm font-bold">今日巩固</h3>
      <p class="mt-1 text-caption text-stone">{{ daily.finished.value ? '今日练习已完成' : daily.records.value.length ? `已作答 ${daily.answered.value} / ${daily.records.value.length} 题` : daily.complete.value ? '今日计划视频已学完' : `视频任务 ${daily.items.value.filter(i => i.done).length} / ${daily.items.value.length}` }}</p>
    </div>
    <UiButton size="sm" :disabled="!daily.complete.value" @click="openDailyPractice">{{ daily.finished.value ? '查看结果' : daily.records.value.length ? '继续练习' : '开始巩固' }}</UiButton>
    <p v-if="daily.state.error" role="alert" class="w-full text-caption text-error">{{ daily.state.error }}</p>
  </section>
</template>

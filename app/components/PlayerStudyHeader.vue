<script setup lang="ts">
import { computed } from 'vue'
import DailyPracticeCard from '~/components/DailyPracticeCard.vue'
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import { formatStudyClock, formatStudyHours } from '~/utils/checkIn'

const { guide, checkIn, openGuide } = useCourseWorkspace()
const completed = computed(() => guide.state.today?.items.filter((item) => item.done).length ?? 0)
const total = computed(() => guide.state.today?.items.length ?? 0)
const detail = computed(
  () =>
    `实际投入 ${formatStudyClock(checkIn.seconds.value)} · 计划目标 ${formatStudyHours(checkIn.targetSeconds.value)} · ${completed.value}/${total.value} 项完成${checkIn.streak.value > 0 ? ` · 连续打卡 ${checkIn.streak.value} 天` : ''}`,
)
</script>

<template>
  <div class="flex items-center justify-center gap-2" aria-label="今日学习与巩固">
    <button
      type="button"
      class="flex h-8 shrink-0 items-center gap-2 rounded-full border border-linen px-3 text-caption transition-colors hover:bg-page-cream"
      aria-label="查看今日学习计划"
      :title="detail"
      @click="openGuide('today')"
    >
      <span class="font-bold">今日学习</span>
      <span :class="checkIn.isAchieved.value ? 'text-emerald-800' : 'text-stone'">{{
        checkIn.isAchieved.value ? '已打卡' : `${checkIn.percent.value}%`
      }}</span>
    </button>
    <DailyPracticeCard compact />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import { formatTime } from '~/utils/time'
import CheckInCalendar from '~/components/CheckInCalendar.vue'
import TodayWorkList from '~/components/TodayWorkList.vue'
import UiButton from '~/components/UiButton.vue'
import type { TodayItem } from '~/types/guide'
import { formatStudyDuration } from '~/utils/guide'
import { BUDGET_LABELS, formatMinutes } from '~/utils/studyProgram'
const emit = defineEmits<{ segment: [item: TodayItem]; question: [id: string]; plan: [] }>()
const guide = useGuide()
const today = computed(() => guide.state.today)
const minutes = ref(30)
watch(() => today.value?.minutes, value => { minutes.value = value ?? 30 }, { immediate: true })
const done = computed(() => today.value?.items.filter(i => i.done) ?? [])
const next = computed(() => today.value?.items.find(i => !i.done))
const totalSeconds = computed(() => today.value?.items.reduce((n, i) => n + i.seconds, 0) ?? 0)
function start(item: TodayItem) {
  if (item.questionId) emit('question', item.questionId)
  else emit('segment', item)
}
const allocationText = computed(() => {
  const b = guide.todayBudget.value
  if (!b) return ''
  return (Object.keys(BUDGET_LABELS) as Array<keyof typeof BUDGET_LABELS>).filter(k => b[k] > 0).map(k => `${BUDGET_LABELS[k]} ${formatMinutes(b[k])}`).join(' · ')
})
const intro = computed(() => {
  const plan = guide.state.plan
  if (!plan) return '尚未定制 AI 学习路线。定制路线后可设定每日学习时间。'
  const program = guide.program.value
  if (program && guide.todayTotalMinutes.value !== null) {
    const day = guide.planDay.value ?? 0
    const status = day < 1 ? `计划将于 ${program.startDate} 开始。` : day > program.days ? `计划周期（${program.days} 天）已结束。` : `完整计划第 ${day} / ${program.days} 天${guide.lightDay.value ? '，轻量复盘日' : ''}。`
    return `${status}今日总投入 ${formatMinutes(guide.todayTotalMinutes.value)}${allocationText.value ? `（${allocationText.value}）` : ''}。有效看课时长与记录的实践时间合计达到目标后自动打卡。`
  }
  return `每日学习目标为 ${formatMinutes(plan.dailyMinutes)}。当日有效学习时长达到目标后自动打卡。`
})
function updateMinutes() { guide.refreshToday(Number(minutes.value)); minutes.value = today.value?.minutes ?? 30 }
</script>

<template>
  <section class="mx-auto max-w-2xl space-y-5" aria-label="今日学习安排与打卡">
    <div>
      <p class="text-caption font-bold text-stone">{{ today?.date }} · 每日学习规划与打卡</p>
      <h3 class="mt-2 text-heading-sm">今日学习计划</h3>
      <p class="mt-2 text-body-sm leading-relaxed text-graphite">{{ intro }}</p>
    </div>

    <!-- 学习打卡日历 -->
    <CheckInCalendar @plan="emit('plan')" />
    <div class="pane p-5">
      <form class="flex flex-wrap items-center gap-3" @submit.prevent="updateMinutes">
        <label class="flex items-center gap-2 text-body-sm">{{ guide.program.value ? '今日看课时间' : '今日可用时间' }}
          <VTextField v-model.number="minutes" aria-label="今日可用分钟数" type="number" min="5" max="1440" step="1" required
            class="w-20 text-center" :disabled="!!guide.state.busy" @change="updateMinutes" />分钟
        </label>
        <UiButton size="sm" :disabled="!!guide.state.busy" @click="guide.refreshToday(Math.min(15, guide.state.plan?.dailyMinutes ?? 30))">精简安排（最多 15 分钟）</UiButton>
        <UiButton variant="text" size="sm" :disabled="!!guide.state.busy" @click="guide.refreshToday(null)">恢复每日计划</UiButton>
      </form>
      <p class="mt-3 text-caption text-stone">调整仅对当日生效，次日恢复每日计划。已完成事项及用时计入当日安排。{{ guide.program.value ? '此处仅调整看课时间，实践任务按阶段分配安排。' : '' }}</p>
      <div class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-page-cream p-4">
        <div><p class="text-body font-bold">已完成 {{ done.length }} / {{ today?.items.length ?? 0 }} 项</p><p class="mt-1 text-caption text-stone">安排 {{ formatStudyDuration(totalSeconds) }} · 今天 {{ today?.minutes ?? 30 }} 分钟</p></div>
        <UiButton v-if="next" variant="dark" size="sm" @click="start(next)">开始下一项</UiButton>
      </div>
      <p v-if="totalSeconds > (today?.minutes ?? 30) * 60" class="mt-3 text-caption text-stone">已完成时长超过调整后的可用时间，今日不再新增安排。</p>
      <ol class="mt-3 divide-y divide-linen">
        <li v-for="(item, index) in today?.items" :key="item.id" class="flex items-start gap-3 py-4" :data-today-id="item.id">
          <VCheckbox :model-value="item.done" :aria-label="`完成今日第 ${index + 1} 项`" class="shrink-0"
            @update:model-value="guide.completeTodayItem(item.id, !!$event)" />
          <div class="min-w-0 flex-1">
            <p class="text-caption text-stone">{{ item.kind === 'question' ? '处理疑问' : item.kind === 'review' ? '补学基础' : '学习课节' }} · {{ formatStudyDuration(item.seconds) }}{{ item.estimated ? '（估算）' : '' }}</p>
            <button class="mt-1 max-w-full break-words text-left text-body-sm font-bold hover:text-deep-indigo" :class="item.done ? 'text-stone line-through' : ''" @click="start(item)">
              {{ item.questionId ? guide.state.questions.find(q => q.id === item.questionId)?.text : guide.videoMap.value.get(item.path)?.title }}
            </button>
            <p v-if="item.kind !== 'question'" class="mt-1 text-caption text-stone">{{ formatTime(item.start, true) }} → {{ formatTime(item.end, true) }}</p>
          </div>
        </li>
      </ol>
      <p v-if="!next && today?.items.length" class="py-4 text-body-sm font-bold">今日学习安排已完成。</p>
      <div v-if="!today?.items.length" class="py-6 text-center">
        <p class="text-body-sm text-stone">{{ guide.state.plan ? '当前没有待学课节或待解决疑问，可在知识地图检查掌握情况。' : '请先生成学习路线或记录待解决的疑问。' }}</p>
        <UiButton v-if="!guide.state.plan" class="mt-3" size="sm" @click="emit('plan')">定制学习路线</UiButton>
      </div>
      <section v-if="guide.program.value" class="mt-2 border-t border-linen pt-4" aria-label="今日实践">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h4 class="text-body font-bold">实践任务</h4>
          <p v-if="guide.activeModule.value" class="text-caption text-stone">当前阶段：{{ guide.activeModule.value.title }}</p>
        </div>
        <TodayWorkList v-if="guide.todayWork.value.length" class="mt-3" />
        <p v-else class="mt-2 text-caption text-stone">{{ guide.activeModule.value?.practice ? '当前阶段的实践任务均已完成或今日未安排。' : '当前阶段尚未设置实践任务，可在“定制路线”中补全或导入。' }}</p>
      </section>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-linen pt-4">
        <p class="max-w-sm text-caption text-stone">播放到片段终点会显示提醒，可记录笔记或进行课后练习。完成事项需主动勾选，掌握程度单独记录。</p>
        <UiButton variant="text" size="sm" :disabled="!!guide.state.busy" @click="guide.refreshToday()">按最新进度更新</UiButton>
      </div>
    </div>
  </section>
</template>

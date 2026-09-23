<script setup lang="ts">
import type { TodayItem } from '~/types/guide'
import { formatStudyDuration } from '~/utils/guide'
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
function updateMinutes() { guide.refreshToday(Number(minutes.value)); minutes.value = today.value?.minutes ?? 30 }
</script>

<template>
  <section class="mx-auto max-w-2xl space-y-5" aria-label="今日学习安排与打卡">
    <div>
      <p class="text-caption font-bold text-stone">{{ today?.date }} · 每日学习规划与打卡</p>
      <h3 class="mt-2 text-heading-sm">按规划坚持，每天都能看得见进步。</h3>
      <p class="mt-2 text-body-sm leading-relaxed text-graphite">
        {{ guide.state.plan ? `AI 规划每日投入 ${guide.state.plan.dailyMinutes >= 60 ? `${Math.floor(guide.state.plan.dailyMinutes / 60)} 小时` : ''}${guide.state.plan.dailyMinutes % 60 ? ` ${guide.state.plan.dailyMinutes % 60} 分钟` : ''}。累计有效学习达到规划时间后自动在日历打勾打卡。` : '尚未定制 AI 学习路线，建议先定制路线以设定每日规划学习时间。' }}
      </p>
    </div>

    <!-- 学习打卡日历 -->
    <CheckInCalendar @plan="emit('plan')" />
    <div class="pane p-5">
      <form class="flex flex-wrap items-center gap-3" @submit.prevent="updateMinutes">
        <label class="flex items-center gap-2 text-body-sm">今天可用
          <input v-model.number="minutes" aria-label="今天可用分钟数" type="number" min="5" max="1440" step="1" required
            class="w-20 rounded-xl border border-linen bg-page-cream px-3 py-2 text-center" :disabled="!!guide.state.busy" @change="updateMinutes" />分钟
        </label>
        <UiButton size="sm" :disabled="!!guide.state.busy" @click="guide.refreshToday(Math.min(15, guide.state.plan?.dailyMinutes ?? 30))">时间不多，短安排</UiButton>
        <button type="button" class="text-caption text-stone underline" :disabled="!!guide.state.busy" @click="guide.refreshToday(null)">按每日计划</button>
      </form>
      <p class="mt-3 text-caption text-stone">仅调整今天，明天恢复每日计划。已完成事项会保留并占用今日预算。</p>
      <div class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-page-cream p-4">
        <div><p class="text-body font-bold">已完成 {{ done.length }} / {{ today?.items.length ?? 0 }} 项</p><p class="mt-1 text-caption text-stone">安排 {{ formatStudyDuration(totalSeconds) }} · 今天 {{ today?.minutes ?? 30 }} 分钟</p></div>
        <UiButton v-if="next" variant="dark" size="sm" @click="start(next)">开始下一项</UiButton>
      </div>
      <p v-if="totalSeconds > (today?.minutes ?? 30) * 60" class="mt-3 text-caption text-stone">已完成的时间超过新预算，今天可以休息了。</p>
      <ol class="mt-3 divide-y divide-linen">
        <li v-for="(item, index) in today?.items" :key="item.id" class="flex items-start gap-3 py-4" :data-today-id="item.id">
          <input type="checkbox" :checked="item.done" :aria-label="`完成今日第 ${index + 1} 项`" class="mt-1 accent-charcoal-ink"
            @change="guide.completeTodayItem(item.id, ($event.target as HTMLInputElement).checked)" />
          <div class="min-w-0 flex-1">
            <p class="text-caption text-stone">{{ item.kind === 'question' ? '处理疑问' : item.kind === 'review' ? '补学基础' : '学习课节' }} · {{ formatStudyDuration(item.seconds) }}{{ item.estimated ? '（估算）' : '' }}</p>
            <button class="mt-1 max-w-full break-words text-left text-body-sm font-bold hover:underline" :class="item.done ? 'text-stone line-through' : ''" @click="start(item)">
              {{ item.questionId ? guide.state.questions.find(q => q.id === item.questionId)?.text : guide.videoMap.value.get(item.path)?.title }}
            </button>
            <p v-if="item.kind !== 'question'" class="mt-1 text-caption text-stone">{{ formatTime(item.start, true) }} → {{ formatTime(item.end, true) }}</p>
          </div>
        </li>
      </ol>
      <p v-if="!next && today?.items.length" class="py-4 text-body-sm font-bold">今天的安排已完成，给自己留一点消化的时间。</p>
      <div v-if="!today?.items.length" class="py-6 text-center">
        <p class="text-body-sm text-stone">{{ guide.state.plan ? '当前没有待学课节或待解决疑问，可在知识地图检查掌握情况。' : '先生成路线，或记下一个想解决的疑问。' }}</p>
        <UiButton v-if="!guide.state.plan" class="mt-3" size="sm" @click="emit('plan')">去定制路线</UiButton>
      </div>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-linen pt-4">
        <p class="max-w-sm text-caption text-stone">播放到片段终点会显示提醒，可记笔记或做一小练。完成事项需主动勾选，掌握程度单独记录。</p>
        <button type="button" class="text-caption font-bold underline" :disabled="!!guide.state.busy" @click="guide.refreshToday()">按最新进度更新</button>
      </div>
    </div>
  </section>
</template>

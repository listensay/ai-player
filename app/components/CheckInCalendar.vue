<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCheckIn } from '~/composables/useStudyCheckIn'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
import { calendarDays, formatStudyClock, formatStudyHours } from '~/utils/checkIn'
import { localDayKey } from '~/utils/learningFeedback'

const props = withDefaults(defineProps<{
  compact?: boolean
}>(), {
  compact: false,
})

const emit = defineEmits<{
  plan: []
}>()

const checkIn = useCheckIn()
const todayKey = computed(() => checkIn?.state.date ?? localDayKey())

const now = new Date()
const viewYear = ref(now.getFullYear())
const viewMonth = ref(now.getMonth())

const selectedDate = ref(todayKey.value)

watch(todayKey, (newVal) => {
  if (!selectedDate.value) selectedDate.value = newVal
})

function prevMonth() {
  if (viewMonth.value === 0) {
    viewYear.value--
    viewMonth.value = 11
  } else {
    viewMonth.value--
  }
}

function nextMonth() {
  if (viewMonth.value === 11) {
    viewYear.value++
    viewMonth.value = 0
  } else {
    viewMonth.value++
  }
}

function goToday() {
  const current = new Date()
  viewYear.value = current.getFullYear()
  viewMonth.value = current.getMonth()
  selectedDate.value = todayKey.value
}

const monthLabel = computed(() => {
  return `${viewYear.value} 年 ${viewMonth.value + 1} 月`
})

const days = computed(() => {
  return calendarDays(viewYear.value, viewMonth.value).map((cell) => {
    const record = checkIn?.state.days[cell.date]
    const isChecked = record?.checkedAt != null
    const isToday = cell.date === todayKey.value
    const isSelected = cell.date === selectedDate.value
    const seconds = checkIn?.secondsFor(cell.date) ?? record?.seconds ?? 0
    const targetSeconds = record?.targetSeconds ?? ((checkIn?.minutesFor(cell.date) ?? 120) * 60)
    return {
      ...cell,
      record,
      isChecked,
      isToday,
      isSelected,
      seconds,
      targetSeconds,
    }
  })
})

const selectedDetail = computed(() => {
  if (!selectedDate.value) return null
  const cell = days.value.find(d => d.date === selectedDate.value)
  const record = checkIn?.state.days[selectedDate.value]
  const isChecked = record?.checkedAt != null
  const seconds = checkIn?.secondsFor(selectedDate.value) ?? record?.seconds ?? 0
  const targetSeconds = record?.targetSeconds ?? ((checkIn?.minutesFor(selectedDate.value) ?? 120) * 60)
  const isToday = selectedDate.value === todayKey.value

  let checkedTimeStr = ''
  if (record?.checkedAt) {
    const d = new Date(record.checkedAt)
    checkedTimeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return {
    date: selectedDate.value,
    isToday,
    isChecked,
    checkedTimeStr,
    seconds,
    targetSeconds,
    percent: targetSeconds > 0 ? Math.min(100, Math.round((seconds / targetSeconds) * 100)) : 0,
    remainingSeconds: Math.max(0, targetSeconds - seconds),
  }
})

const weekDays = ['一', '二', '三', '四', '五', '六', '日']
</script>

<template>
  <div class="check-in-calendar min-w-0 space-y-4" aria-label="学习打卡日历">
    <!-- 打卡统计顶栏 -->
    <div v-if="compact" class="flex flex-wrap gap-x-5 gap-y-2 text-caption text-stone">
      <span>连续打卡 <strong class="text-charcoal-ink">{{ checkIn?.streak.value ?? 0 }}</strong> 天</span>
      <span>累计打卡 <strong class="text-charcoal-ink">{{ checkIn?.total.value ?? 0 }}</strong> 天</span>
    </div>
    <div v-else class="check-in-stats grid grid-cols-2 gap-3">
      <div class="min-w-0 rounded-2xl border border-linen bg-page-cream p-3 text-center sm:p-4">
        <p class="text-caption font-medium text-stone">连续打卡</p>
        <p class="mt-1 text-heading-sm font-bold text-charcoal-ink">
          {{ checkIn?.streak.value ?? 0 }} <span class="text-caption font-normal text-stone">天</span>
        </p>
      </div>

      <div class="min-w-0 rounded-2xl border border-linen bg-page-cream p-3 text-center sm:p-4">
        <p class="text-caption font-medium text-stone">累计打卡</p>
        <p class="mt-1 text-heading-sm font-bold text-charcoal-ink">
          {{ checkIn?.total.value ?? 0 }} <span class="text-caption font-normal text-stone">天</span>
        </p>
      </div>

      <div class="min-w-0 rounded-2xl border border-linen bg-page-cream p-3 text-center sm:p-4">
        <p class="text-caption font-medium text-stone">今日学习目标</p>
        <p class="mt-1 text-subheading font-bold leading-snug text-charcoal-ink">
          {{ formatStudyHours(checkIn?.targetSeconds.value ?? 0) }}
        </p>
      </div>

      <div class="min-w-0 rounded-2xl border border-linen p-3 text-center sm:p-4" :class="checkIn?.isAchieved.value ? 'bg-emerald-50 border-emerald-300' : 'bg-page-cream'">
        <p class="text-caption font-medium" :class="checkIn?.isAchieved.value ? 'text-emerald-700 font-bold' : 'text-stone'">
          今日打卡
        </p>
        <div class="mt-1 flex items-center justify-center gap-1">
          <span v-if="checkIn?.isAchieved.value" class="inline-flex items-center gap-1 text-body-sm font-bold text-emerald-700">
            <span class="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-pure-white">
              <AppIcon name="check" :size="13" />
            </span>
            已打卡
          </span>
          <span v-else class="text-body-sm font-bold text-charcoal-ink">
            目标完成 {{ checkIn?.percent.value ?? 0 }}%
          </span>
        </div>
      </div>
    </div>

    <!-- 今日学习时长进度 -->
    <div v-if="compact">
      <p class="flex flex-wrap items-baseline justify-between gap-2 text-caption text-stone">
        <span>今日 {{ formatStudyClock(checkIn?.seconds.value ?? 0) }} / {{ formatStudyHours(checkIn?.targetSeconds.value ?? 0) }}</span>
        <strong class="text-deep-indigo">{{ checkIn?.isAchieved.value ? '已打卡' : `目标完成 ${checkIn?.percent.value ?? 0}%` }}</strong>
      </p>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-linen"><div class="h-full rounded-full bg-deep-indigo" :style="{ width: `${checkIn?.percent.value ?? 0}%` }" /></div>
    </div>
    <div v-else class="rounded-2xl border border-linen bg-pure-white p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span class="text-body-sm font-bold">今日学习时长</span>
          <span class="text-caption text-stone">
            {{ formatStudyClock(checkIn?.seconds.value ?? 0) }} / {{ formatStudyHours(checkIn?.targetSeconds.value ?? 0) }}
          </span>
        </div>
        <div>
          <span v-if="checkIn?.isAchieved.value" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-caption font-bold text-emerald-800">
            <AppIcon name="check" :size="12" /> 今日目标已完成
          </span>
          <span v-else class="text-caption text-stone">
            距打卡目标还需 {{ formatStudyHours(checkIn?.remainingSeconds.value ?? 0) }}
          </span>
        </div>
      </div>
      <!-- 进度条 -->
      <div class="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-linen">
        <div
          class="h-full rounded-full transition-all duration-300"
          :class="checkIn?.isAchieved.value ? 'bg-emerald-600' : 'bg-charcoal-ink'"
          :style="{ width: `${checkIn?.percent.value ?? 0}%` }"
        />
      </div>
    </div>

    <!-- 日历主体 -->
    <div :class="compact ? '' : 'rounded-2xl border border-linen bg-pure-white p-4 sm:p-5'">
      <!-- 月份切换 -->
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h4 class="text-body font-bold text-charcoal-ink">{{ monthLabel }}</h4>
        <div class="flex items-center gap-1.5">
          <UiButton size="sm" variant="ghost" title="上个月" @click="prevMonth">
            ‹
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="goToday">
            今天
          </UiButton>
          <UiButton size="sm" variant="ghost" title="下个月" @click="nextMonth">
            ›
          </UiButton>
        </div>
      </div>

      <!-- 星期表头 -->
      <div class="grid grid-cols-7 gap-1 text-center text-caption font-bold text-stone">
        <div v-for="w in weekDays" :key="w" class="py-1">{{ w }}</div>
      </div>

      <!-- 日期网格 -->
      <div class="mt-1 grid grid-cols-7 gap-1">
        <button
          v-for="cell in days"
          :key="cell.date"
          type="button"
          class="relative flex flex-col items-center justify-between rounded-xl p-1.5 transition-all text-center"
          :class="[
            compact ? 'min-h-11' : 'min-h-[58px]',
            !cell.currentMonth ? 'text-stone/40 opacity-50' : 'text-charcoal-ink',
            cell.isSelected ? 'ring-2 ring-charcoal-ink' : 'hover:bg-page-cream',
            cell.isToday ? 'border border-deep-indigo/40 bg-page-cream/60' : '',
            cell.isChecked ? 'bg-emerald-50/70 border border-emerald-200' : 'border border-transparent'
          ]"
          :aria-label="`${cell.date} ${cell.isChecked ? '已打卡' : '未打卡'}`"
          @click="selectedDate = cell.date"
        >
          <!-- 顶部：日期数字和今日标 -->
          <div class="flex w-full items-center justify-between px-0.5">
            <span
              class="text-caption font-bold"
              :class="cell.isToday ? 'text-deep-indigo' : ''"
            >
              {{ cell.day }}
            </span>
            <span v-if="cell.isToday" class="rounded bg-deep-indigo/15 px-1 py-0.2 text-[10px] font-bold text-deep-indigo">
              今
            </span>
          </div>

          <!-- 中间/底部：打卡打勾标记或有效时间 -->
          <div class="my-auto flex flex-col items-center justify-center">
            <!-- 打卡达标：显著绿色打勾图标 -->
            <div
              v-if="cell.isChecked"
              class="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-pure-white shadow-xs"
              title="已打卡"
            >
              <AppIcon name="check" :size="13" />
            </div>
            <!-- 未达标但有学习时间 -->
            <span
              v-else-if="cell.seconds > 0"
              class="text-[11px] font-medium text-stone"
            >
              {{ Math.floor(cell.seconds / 60) }}m
            </span>
          </div>
        </button>
      </div>

      <!-- 选中日期详情卡片 -->
      <div v-if="compact && selectedDetail" class="mt-4 rounded-xl bg-page-cream p-3 text-caption leading-relaxed">
        <p class="flex flex-wrap justify-between gap-2"><strong>{{ selectedDetail.date }}{{ selectedDetail.isToday ? ' · 今天' : '' }}</strong><span>{{ selectedDetail.isChecked ? '已打卡' : selectedDetail.seconds > 0 ? '学习中' : '未学习' }}</span></p>
        <p class="mt-1 text-stone">已学 {{ formatStudyClock(selectedDetail.seconds) }} · 目标 {{ formatStudyHours(selectedDetail.targetSeconds) }}</p>
      </div>
      <div v-else-if="selectedDetail" class="mt-4 rounded-xl border border-linen bg-page-cream p-3.5 text-body-sm">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <span class="font-bold text-charcoal-ink">{{ selectedDetail.date }}</span>
            <span v-if="selectedDetail.isToday" class="rounded bg-deep-indigo text-pure-white px-1.5 py-0.5 text-caption font-bold">今天</span>
            <span
              v-if="selectedDetail.isChecked"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-caption font-bold text-emerald-800"
            >
              <AppIcon name="check" :size="12" /> 已打卡
              <span v-if="selectedDetail.checkedTimeStr">({{ selectedDetail.checkedTimeStr }})</span>
            </span>
            <span v-else-if="selectedDetail.seconds > 0" class="rounded-full bg-stone/15 px-2 py-0.5 text-caption text-stone">
              未达标
            </span>
            <span v-else class="text-caption text-stone">未学习</span>
          </div>
          <span class="text-caption text-stone">学习目标：{{ formatStudyHours(selectedDetail.targetSeconds) }}</span>
        </div>

        <div class="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption text-graphite">
          <span>{{ checkIn?.includesWork.value ? '学习时长（视频与实践）' : '有效学习时长' }}：<strong class="text-charcoal-ink">{{ formatStudyClock(selectedDetail.seconds) }}</strong></span>
          <span v-if="!selectedDetail.isChecked && selectedDetail.remainingSeconds > 0" class="text-stone">
            距学习目标还需 {{ formatStudyHours(selectedDetail.remainingSeconds) }}
          </span>
          <span v-else-if="selectedDetail.isChecked" class="text-emerald-700 font-medium">
            当日目标已完成
          </span>
        </div>
      </div>

      <!-- 规则说明 -->
      <p v-if="!compact" class="mt-4 text-caption leading-relaxed text-stone">
        <strong>打卡规则</strong>：{{ checkIn?.includesWork.value ? '当日有效观看时长与记录的实践时长合计达标后自动打卡。' : '当日有效学习时长达标后自动打卡。' }}倍速按实际播放时间计时，暂停、缓冲和跳转不计时。
      </p>
    </div>
  </div>
</template>

<style scoped>
.check-in-calendar {
  container-type: inline-size;
}

/* 概览的半宽面板和导学弹窗共用日历，列数取决于面板而非窗口宽度。 */
@container (min-width: 42rem) {
  .check-in-stats {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>

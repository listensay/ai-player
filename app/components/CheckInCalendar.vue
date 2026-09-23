<script setup lang="ts">
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
    const seconds = record?.seconds ?? 0
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
  const seconds = record?.seconds ?? 0
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
  <div class="space-y-4" aria-label="学习打卡日历">
    <!-- 打卡统计顶栏 -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="rounded-2xl border border-linen bg-page-cream p-3 text-center sm:p-4">
        <p class="text-caption font-medium text-stone">连续打卡</p>
        <p class="mt-1 text-heading-sm font-bold text-charcoal-ink">
          {{ checkIn?.streak.value ?? 0 }} <span class="text-caption font-normal text-stone">天</span>
        </p>
      </div>

      <div class="rounded-2xl border border-linen bg-page-cream p-3 text-center sm:p-4">
        <p class="text-caption font-medium text-stone">累计打卡</p>
        <p class="mt-1 text-heading-sm font-bold text-charcoal-ink">
          {{ checkIn?.total.value ?? 0 }} <span class="text-caption font-normal text-stone">天</span>
        </p>
      </div>

      <div class="rounded-2xl border border-linen bg-page-cream p-3 text-center sm:p-4">
        <p class="text-caption font-medium text-stone">今日规划目标</p>
        <p class="mt-1 truncate text-heading-sm font-bold text-charcoal-ink">
          {{ formatStudyHours(checkIn?.targetSeconds.value ?? 0) }}
        </p>
      </div>

      <div class="rounded-2xl border border-linen p-3 text-center sm:p-4" :class="checkIn?.isAchieved.value ? 'bg-emerald-50 border-emerald-300' : 'bg-page-cream'">
        <p class="text-caption font-medium" :class="checkIn?.isAchieved.value ? 'text-emerald-700 font-bold' : 'text-stone'">
          今日打卡状态
        </p>
        <div class="mt-1 flex items-center justify-center gap-1">
          <span v-if="checkIn?.isAchieved.value" class="inline-flex items-center gap-1 text-body-sm font-bold text-emerald-700">
            <span class="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-pure-white">
              <AppIcon name="check" :size="13" />
            </span>
            已打卡
          </span>
          <span v-else class="text-body-sm font-bold text-charcoal-ink">
            已学 {{ checkIn?.percent.value ?? 0 }}%
          </span>
        </div>
      </div>
    </div>

    <!-- 今日学习时长进度 -->
    <div class="rounded-2xl border border-linen bg-pure-white p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span class="text-body-sm font-bold">今日投入时长</span>
          <span class="ml-2 text-caption text-stone">
            {{ formatStudyClock(checkIn?.seconds.value ?? 0) }} / {{ formatStudyHours(checkIn?.targetSeconds.value ?? 0) }}
          </span>
        </div>
        <div>
          <span v-if="checkIn?.isAchieved.value" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-caption font-bold text-emerald-800">
            <AppIcon name="check" :size="12" /> 今日已达成规划目标
          </span>
          <span v-else class="text-caption text-stone">
            还需投入 {{ formatStudyHours(checkIn?.remainingSeconds.value ?? 0) }} 达成打卡
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
    <div class="rounded-2xl border border-linen bg-pure-white p-4 sm:p-5">
      <!-- 月份切换 -->
      <div class="mb-4 flex items-center justify-between">
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
          class="relative flex min-h-[58px] flex-col items-center justify-between rounded-xl p-1.5 transition-all text-center"
          :class="[
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
              title="已打卡成功"
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
      <div v-if="selectedDetail" class="mt-4 rounded-xl border border-linen bg-page-cream p-3.5 text-body-sm">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="font-bold text-charcoal-ink">{{ selectedDetail.date }}</span>
            <span v-if="selectedDetail.isToday" class="rounded bg-deep-indigo text-pure-white px-1.5 py-0.5 text-caption font-bold">今天</span>
            <span
              v-if="selectedDetail.isChecked"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-caption font-bold text-emerald-800"
            >
              <AppIcon name="check" :size="12" /> 已打卡成功
              <span v-if="selectedDetail.checkedTimeStr">({{ selectedDetail.checkedTimeStr }})</span>
            </span>
            <span v-else-if="selectedDetail.seconds > 0" class="rounded-full bg-stone/15 px-2 py-0.5 text-caption text-stone">
              学习中 · 未达标
            </span>
            <span v-else class="text-caption text-stone">未学习</span>
          </div>
          <span class="text-caption text-stone">规划目标：{{ formatStudyHours(selectedDetail.targetSeconds) }}</span>
        </div>

        <div class="mt-2.5 flex flex-wrap items-center justify-between text-caption text-graphite">
          <span>实际有效投入：<strong class="text-charcoal-ink">{{ formatStudyClock(selectedDetail.seconds) }}</strong> ({{ formatStudyHours(selectedDetail.seconds) }})</span>
          <span v-if="!selectedDetail.isChecked && selectedDetail.remainingSeconds > 0" class="text-stone">
            还差 {{ formatStudyHours(selectedDetail.remainingSeconds) }} 达成规划
          </span>
          <span v-else-if="selectedDetail.isChecked" class="text-emerald-700 font-medium">
            已达标当日规划要求
          </span>
        </div>
      </div>

      <!-- 规则说明 -->
      <p class="mt-4 text-caption leading-relaxed text-stone">
        💡 <strong>打卡规则</strong>：根据 AI 规划的学习时间（例如 6 小时），必须在当天累计有效播放达到规划时间后自动打卡，并在日期上方显示绿色打勾（<span class="inline-flex align-middle text-emerald-700 font-bold">✓</span>）。倍速播放按真实物理投入时间计算，暂停、缓冲与跳转不计入，打卡成功后永久保留在历史日历中。
      </p>
    </div>
  </div>
</template>

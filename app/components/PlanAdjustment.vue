<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import type { LearningPlan, StudyBudget } from '~/types/guide'
import { adjustLearningPlan, type PlanAdjustment } from '~/utils/planAdjustment'
import {
  addDays,
  BUDGET_LABELS,
  budgetForDay,
  budgetTotal,
  emptyBudget,
  formatMinutes,
  programDay,
  programDate,
  stageForDay,
  videoFinishDay,
} from '~/utils/studyProgram'
import { calculateDay } from '~/utils/dailyPlan'
import { formatStudyDuration } from '~/utils/guide'
import UiButton from '~/components/UiButton.vue'

const guide = useGuide()
const open = ref(false),
  preview = ref<ReturnType<typeof adjustLearningPlan> | null>(null),
  error = ref('')
const stale = ref(false)
const base = ref<LearningPlan | null>(null)
const form = reactive({
  kind: 'today' as PlanAdjustment['kind'],
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  budget: emptyBudget(),
  weekend: emptyBudget(),
  today: emptyBudget(),
  until: '',
  indefinite: false,
  strategy: 'extend' as 'extend' | 'deadline',
  days: 3,
  limit: 120,
  totalDays: 30,
})
const kinds = computed(() => [
  { title: '调整今天', value: 'today' },
  { title: '每周安排', value: 'weekly' },
  { title: '暂停学习', value: 'pause' },
  ...(base.value?.program?.calendar?.pause ? [{ title: '恢复学习', value: 'resume' }] : []),
  { title: '调整剩余计划', value: 'replan' },
])
const budgetFields = Object.entries(BUDGET_LABELS) as Array<[keyof StudyBudget, string]>
const consumed = computed(() =>
  guide.state.today?.date === guide.todayDate.value
    ? guide.state.today.items.filter((i) => i.done && i.kind !== 'question').reduce((n, i) => n + i.seconds, 0)
    : 0,
)
const weekdays = ['一', '二', '三', '四', '五', '六', '日'].map((title, index) => ({
  title: `周${title}`,
  value: index + 1,
}))
function begin() {
  base.value = guide.planForScheduling()
  const p = base.value.program!
  Object.assign(form, {
    kind: p.calendar?.pause ? 'resume' : guide.program.value ? 'today' : 'weekly',
    weekdays: [...(p.calendar?.weekdays ?? [1, 2, 3, 4, 5, 6, 7])],
    budget: { ...p.budget },
    weekend: { ...(p.calendar?.weekendBudget ?? p.budget) },
    today: { ...(guide.todayBudget.value ?? p.budget) },
    until: addDays(guide.todayDate.value, 3),
    indefinite: false,
    strategy: 'extend',
    days: 3,
    limit: Math.max(120, budgetTotal(p.budget)),
    totalDays: p.days,
  })
  preview.value = null
  error.value = ''
  stale.value = false
  open.value = true
}
watch(
  form,
  () => {
    preview.value = null
    error.value = ''
  },
  { deep: true },
)
watch(
  () => guide.todayDate.value,
  () => {
    open.value = false
  },
)
watch(
  () => guide.state.plan,
  () => {
    if (open.value) {
      preview.value = null
      stale.value = true
      error.value = '计划已发生变化，请关闭后重新调整。'
    }
  },
  { deep: true },
)
function prepare() {
  if (!base.value || stale.value) return
  try {
    let action: PlanAdjustment
    if (form.kind === 'weekly')
      action = { kind: 'weekly', weekdays: form.weekdays, budget: form.budget, weekendBudget: form.weekend }
    else if (form.kind === 'today') action = { kind: 'today', budget: form.today }
    else if (form.kind === 'pause') action = { kind: 'pause', until: form.indefinite ? null : form.until }
    else if (form.kind === 'resume') action = { kind: 'resume', strategy: form.strategy, limit: Number(form.limit) }
    else action = { kind: 'replan', strategy: form.strategy, days: Number(form.days), limit: Number(form.limit) }
    const source = JSON.parse(JSON.stringify(base.value)) as LearningPlan
    if (form.kind === 'weekly') source.program!.days = Number(form.totalDays)
    preview.value = adjustLearningPlan(
      source,
      guide.todayDate.value,
      action,
      guide.schedule.value.remainingSeconds ||
        calculateDay({ ...guide.dayContext.value, plan: source }, guide.todayDate.value).schedule.remainingSeconds,
      consumed.value,
    )
    error.value = ''
  } catch (e) {
    error.value = (e as Error).message
    preview.value = null
  }
}
const projected = computed(() =>
  preview.value
    ? calculateDay(
        {
          ...guide.dayContext.value,
          plan: preview.value.plan,
          today: guide.state.today ? { ...guide.state.today, override: null } : null,
        },
        guide.todayDate.value,
      )
    : null,
)
const week = computed(() => {
  const plan = preview.value?.plan
  if (!plan?.program) return []
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(guide.todayDate.value, index),
      day = programDay(plan.program!, date),
      stage = stageForDay(plan.modules, day)
    const budget = budgetForDay(plan.program!, stage?.practice, day)
    return { date, budget, stage: stage?.title ?? '课程学习' }
  })
})
const changes = computed(
  () =>
    preview.value?.plan.modules.flatMap((module) => {
      const old = base.value?.modules.find((m) => m.id === module.id)?.practice,
        next = module.practice
      return old && next && (old.startDay !== next.startDay || old.endDay !== next.endDay)
        ? [{ title: module.title, old, next }]
        : []
    }) ?? [],
)
function finish(plan: LearningPlan | null) {
  if (!plan?.program) return '未设置'
  const remaining = calculateDay({ ...guide.dayContext.value, plan }, guide.todayDate.value).schedule.remainingSeconds
  const day = videoFinishDay(plan.program, plan.modules, guide.todayDate.value, remaining, consumed.value)
  return day === null ? '视频已看完' : day === Infinity ? '当前安排无法估算' : programDate(plan.program, day)
}
function apply() {
  if (!preview.value || preview.value.shortage > 0 || stale.value) return
  if (guide.applySchedule(preview.value.plan, kinds.value.find((k) => k.value === form.kind)?.title ?? '调整计划'))
    open.value = false
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UiButton
      size="sm"
      :disabled="!guide.guideReady.value || !guide.recordsReady.value || !!guide.state.busy"
      @click="begin"
      >{{ guide.program.value ? '调整计划' : '设置学习计划' }}</UiButton
    >
    <UiButton
      v-if="guide.state.records.undo?.scheduleOnly"
      variant="text"
      size="sm"
      :disabled="!!guide.state.busy"
      @click="guide.undo()"
      >撤销调整</UiButton
    >
  </div>
  <VDialog v-model="open" max-width="880" scrollable>
    <VCard class="plan-adjustment-card" rounded="xl" :elevation="0">
      <div class="flex shrink-0 items-center justify-between gap-3">
        <h2 class="text-heading-sm">学习计划</h2>
        <UiButton variant="text" size="sm" @click="open = false">关闭</UiButton>
      </div>
      <div class="scroll-soft mt-3 min-h-0 space-y-5 overflow-y-auto pr-1 pt-2">
        <p v-if="!guide.schedulingEnabled.value" role="status" class="text-body-sm text-stone">
          课程已暂停或归档。请先在首页恢复课程，再安排学习。
        </p>
        <VSelect v-model="form.kind" label="调整内容" :items="kinds" />
        <template v-if="form.kind === 'weekly'">
          <VTextField v-model.number="form.totalDays" type="number" min="1" max="1095" label="计划总天数" />
          <div class="grid grid-cols-4 gap-1 sm:grid-cols-7">
            <VCheckbox
              v-for="day in weekdays"
              :key="day.value"
              v-model="form.weekdays"
              :value="day.value"
              :label="day.title"
            />
          </div>
          <div class="grid gap-5 sm:grid-cols-2">
            <section class="space-y-3">
              <h3 class="text-body font-bold">工作日 · {{ formatMinutes(budgetTotal(form.budget)) }}</h3>
              <VTextField
                v-for="[key, label] in budgetFields"
                :key="key"
                v-model.number="form.budget[key]"
                :label="`${label}（分钟）`"
                type="number"
                min="0"
                max="1440"
              />
            </section>
            <section class="space-y-3">
              <h3 class="text-body font-bold">周末 · {{ formatMinutes(budgetTotal(form.weekend)) }}</h3>
              <VTextField
                v-for="[key, label] in budgetFields"
                :key="key"
                v-model.number="form.weekend[key]"
                :label="`${label}（分钟）`"
                type="number"
                min="0"
                max="1440"
              />
            </section>
          </div>
          <p class="text-caption text-stone">已有阶段的工作日专属预算继续生效；临时日期安排优先于每周安排。</p>
        </template>
        <template v-else-if="form.kind === 'today'">
          <div class="grid grid-cols-2 gap-3">
            <VTextField
              v-for="[key, label] in budgetFields"
              :key="key"
              v-model.number="form.today[key]"
              :label="`${label}（分钟）`"
              type="number"
              min="0"
              max="1440"
            />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-body-sm">合计 {{ formatMinutes(budgetTotal(form.today)) }}</span
            ><UiButton size="sm" variant="ghost" @click="form.today = emptyBudget()">今天休息</UiButton>
          </div>
        </template>
        <template v-else-if="form.kind === 'pause'">
          <VCheckbox v-model="form.indefinite" label="由我手动恢复" />
          <VTextField
            v-if="!form.indefinite"
            v-model="form.until"
            type="date"
            :min="addDays(guide.todayDate.value, 1)"
            label="恢复日期"
          />
          <p class="text-caption text-stone">暂停期间不新增任务。到期恢复原排期，可再选择顺延。</p>
        </template>
        <template v-else>
          <VRadioGroup v-model="form.strategy" label="剩余安排" hide-details>
            <VRadio value="extend" label="保持每日投入，顺延计划与阶段" />
            <VRadio value="deadline" label="保留结束日期，在上限内增加观看时间" />
          </VRadioGroup>
          <VTextField
            v-if="form.strategy === 'extend' && form.kind === 'replan'"
            v-model.number="form.days"
            type="number"
            min="0"
            max="1095"
            label="顺延天数"
          />
          <VTextField
            v-if="form.strategy === 'deadline'"
            v-model.number="form.limit"
            type="number"
            min="5"
            max="1440"
            label="每日总投入上限（分钟）"
          />
        </template>
        <p v-if="error" role="alert" class="text-body-sm text-error">{{ error }}</p>
        <section
          v-if="preview && projected"
          class="rounded-2xl border border-linen bg-page-cream p-4"
          aria-label="计划调整预览"
        >
          <h3 class="text-body font-bold">调整预览</h3>
          <dl class="mt-3 grid grid-cols-2 gap-3 text-body-sm">
            <dt>今日剩余任务</dt>
            <dd>
              {{
                projected.today.items.filter((i) => !i.done).length +
                projected.work.filter((i) => !i.done && i.targetMinutes > i.minutes).length
              }}
              项
            </dd>
            <dt>预计看完视频</dt>
            <dd>{{ finish(base) }} → {{ finish(preview.plan) }}</dd>
            <dt>计划结束日期</dt>
            <dd>
              {{ programDate(base!.program!, base!.program!.days) }} →
              {{ programDate(preview.plan.program!, preview.plan.program!.days) }}
            </dd>
          </dl>
          <p v-if="preview.shortage" role="alert" class="mt-3 text-body-sm text-error">
            每日上限内仍差 {{ formatStudyDuration(preview.shortage) }} 视频学习时间，请提高上限或选择顺延。
          </p>
          <div class="mt-4 overflow-x-auto">
            <table class="w-full text-left text-caption">
              <caption class="pb-2 text-left font-bold">
                未来七天预算 · 视频按 1 倍速估算
              </caption>
              <thead>
                <tr>
                  <th class="py-2">日期</th>
                  <th>观看</th>
                  <th>实践</th>
                  <th>阶段</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="day in week" :key="day.date" class="border-t border-linen">
                  <td class="py-2">{{ day.date.slice(5) }}</td>
                  <td>{{ day.budget.video }} 分钟</td>
                  <td>{{ budgetTotal(day.budget) - day.budget.video }} 分钟</td>
                  <td>{{ budgetTotal(day.budget) ? day.stage : '休息' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul v-if="changes.length" class="mt-3 space-y-2 text-caption">
            <li v-for="change in changes" :key="change.title">
              {{ change.title }}：第 {{ change.old.startDay }}–{{ change.old.endDay }} 天 → 第
              {{ change.next.startDay }}–{{ change.next.endDay }} 天
            </li>
          </ul>
        </section>
      </div>
      <div class="mt-5 flex shrink-0 justify-end gap-3 border-t border-linen pt-4">
        <UiButton variant="ghost" @click="open = false">取消</UiButton>
        <UiButton
          v-if="!preview"
          variant="dark"
          :disabled="stale || !guide.schedulingEnabled.value || !!guide.state.busy"
          @click="prepare"
          >预览调整</UiButton
        >
        <UiButton v-else variant="dark" :disabled="preview.shortage > 0 || !!guide.state.busy" @click="apply"
          >应用调整</UiButton
        >
      </div>
    </VCard>
  </VDialog>
</template>

<style scoped>
.v-card.plan-adjustment-card {
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  padding: 20px;
  border-radius: 24px;
  overflow: hidden;
}

@media (min-width: 768px) {
  .v-card.plan-adjustment-card {
    padding: 28px;
  }
}
</style>

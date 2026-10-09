<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useLearningManagement } from '~/composables/useLearningManagement'
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import { adaptivePlan, flowInsights, planHealth } from '~/utils/learningOutcomes'
import { addProtection, canMakeUp, protectedStreak } from '~/utils/learningManagement'
import { addDays } from '~/utils/studyProgram'
import { localDayKey } from '~/utils/learningFeedback'
import { databaseRequest, flushDatabaseWrites } from '~/utils/database'
import UiButton from './UiButton.vue'
import StudyFormDialog from './StudyFormDialog.vue'
import { usePlanHealthAdvice } from '~/composables/usePlanHealthAdvice'
const learning = useLearningManagement(),
  workspace = useCourseWorkspace()
const advice = usePlanHealthAdvice(),
  reason = ref('')
const courseId = ref(''),
  strategy = ref<'lighter' | 'weekend'>('lighter'),
  error = ref(''),
  busy = ref(false)
const makeupDate = ref('')
const notice = ref('')
const preview = ref<ReturnType<typeof adaptivePlan> | null>(null),
  expectedRaw = ref(''),
  expectedCurrent = ref(''),
  previewCourse = ref(''),
  previewDate = ref('')
const options = computed(() => learning.courses.value.map((c) => ({ title: c.course.name, value: c.course.id })))
watch(
  options,
  (choices) => {
    if (!choices.some((c) => c.value === courseId.value))
      courseId.value = workspace.course.value?.id ?? choices[0]?.value ?? ''
  },
  { immediate: true },
)
const course = computed(() => learning.courses.value.find((c) => c.course.id === courseId.value))
const health = computed(() => (course.value ? planHealth(course.value, learning.date.value) : null))
const flow = computed(() => flowInsights(learning.state.data.flows, courseId.value))
const streak = computed(() =>
  course.value ? protectedStreak(course.value, learning.state.data, learning.date.value) : 0,
)
const energy = computed(
  () =>
    2 -
    learning.state.data.protections.filter(
      (p) =>
        p.kind === 'freeze' &&
        new Date(p.at).getFullYear() === new Date().getFullYear() &&
        new Date(p.at).getMonth() === new Date().getMonth(),
    ).length,
)
const makeup = computed(() =>
  course.value
    ? Object.keys(course.value.snapshots)
        .filter(
          (d) =>
            canMakeUp(course.value!, d, learning.date.value) &&
            !learning.state.data.protections.some((p) => p.courseId === courseId.value && p.date === d),
        )
        .sort()
        .reverse()
    : [],
)
const yesterday = computed(() => addDays(learning.date.value, -1))
watch(
  makeup,
  (dates) => {
    if (!dates.includes(makeupDate.value)) makeupDate.value = dates[0] ?? ''
  },
  { immediate: true },
)
watch([courseId, learning.date], () => {
  advice.cancel()
  preview.value = null
  reason.value = ''
})
const canFreeze = computed(
  () =>
    course.value &&
    energy.value > 0 &&
    course.value.days[yesterday.value]?.checkedAt == null &&
    (course.value.snapshots[yesterday.value]?.plannedMinutes ??
      course.value.days[yesterday.value]?.targetSeconds ??
      0) > 0 &&
    !learning.state.data.protections.some((p) => p.courseId === courseId.value && p.date === yesterday.value),
)
onMounted(() => void learning.refresh())
async function propose(withAi = false) {
  const id = courseId.value,
    day = learning.date.value
  busy.value = true
  error.value = ''
  try {
    workspace.guide.persist()
    await flushDatabaseWrites()
    await learning.refresh()
    if (!course.value || !health.value || id !== courseId.value || day !== learning.date.value) return
    const selected = course.value
    const current = JSON.stringify(workspace.guide.state.plan)
    const raw = JSON.stringify(selected.sourcePlan ?? selected.context?.plan)
    const suggestion = withAi ? await advice.suggest(workspace.guide.state.settings, health.value) : null
    if (withAi && !suggestion) return
    if (id !== courseId.value || day !== learning.date.value) return
    if (suggestion) strategy.value = suggestion.strategy
    reason.value = suggestion?.reason ?? ''
    preview.value = adaptivePlan(
      selected,
      learning.date.value,
      suggestion?.minutes ?? health.value.recommended,
      strategy.value,
    )
    expectedRaw.value = raw
    expectedCurrent.value = current
    previewCourse.value = courseId.value
    previewDate.value = learning.date.value
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
async function apply() {
  if (!preview.value) return
  busy.value = true
  error.value = ''
  try {
    if (previewDate.value !== localDayKey()) throw Error('日期已变化，请重新预览。')
    if (workspace.course.value?.id === previewCourse.value) {
      if (JSON.stringify(workspace.guide.state.plan) !== expectedCurrent.value) throw Error('计划已修改，请重新预览。')
      if (!workspace.guide.applySchedule(preview.value.plan, '自适应减负'))
        throw Error(workspace.guide.state.error || '计划调整未完成。')
      workspace.guide.persist()
      await flushDatabaseWrites()
    } else
      await databaseRequest('learning-plan', {
        method: 'POST',
        body: { courseId: previewCourse.value, expectedPlan: JSON.parse(expectedRaw.value), plan: preview.value.plan },
      })
    preview.value = null
    notice.value = '后续计划已减负，可撤销本次调整。'
    await learning.refresh()
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
async function protect(date: string, kind: 'freeze' | 'makeup') {
  if (!course.value) return
  const selected = course.value
  await learning.mutate((data) => addProtection(data, selected, date, kind, Date.now()))
}
async function undoPlan() {
  if (!course.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (workspace.course.value?.id === courseId.value) {
      if (!workspace.guide.undo()) throw Error(workspace.guide.state.error || '撤销未完成。')
      workspace.guide.persist()
      await flushDatabaseWrites()
    } else {
      const previous = course.value.context?.records.undo
      if (!previous) return
      await databaseRequest('learning-plan', {
        method: 'POST',
        body: {
          courseId: courseId.value,
          expectedPlan: course.value.sourcePlan ?? course.value.context?.plan,
          plan: previous.plan,
          undo: true,
        },
      })
    }
    await learning.refresh()
    notice.value = '已恢复调整前的学习计划。'
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="space-y-5" aria-label="学习节奏与心流">
    <p v-if="notice" role="status" class="text-body-sm text-deep-indigo">{{ notice }}</p>
    <VSelect v-model="courseId" label="复盘课程" :items="options" />
    <p
      v-if="error || advice.error.value || learning.state.error || learning.sourceError.value"
      role="alert"
      class="text-body-sm text-error"
    >
      {{ error || advice.error.value || learning.state.error || learning.sourceError.value }}
    </p>
    <article v-if="health && course" class="pane space-y-4 bg-pure-white p-5">
      <h3 class="text-subheading">计划健康度</h3>
      <p v-if="health.days.length" class="text-body-sm">
        近期平均每天学习 {{ health.average }} 分钟，计划为 {{ health.budget }} 分钟。
      </p>
      <p v-else class="text-body-sm text-stone">开始学习后，来这里看看适合自己的节奏。</p>
      <template v-if="health.overloaded"
        ><p class="text-body-sm text-deep-indigo">最近有些忙，可以把计划放轻一点。</p>
        <VSelect
          v-model="strategy"
          label="减负方案"
          :items="[
            { title: `每天约 ${health.recommended} 分钟，顺延结课`, value: 'lighter' },
            { title: '工作日减量，周末多学一些', value: 'weekend' },
          ]"
        />
        <div class="flex flex-wrap items-center gap-3">
          <UiButton :disabled="busy || !course.context?.plan?.program" variant="dark" @click="propose(false)"
            >预览减负方案</UiButton
          >
          <UiButton :disabled="busy || !course.context?.plan?.program" @click="propose(true)">AI 减负建议</UiButton>
        </div></template
      >
      <UiButton
        v-if="
          (workspace.course.value?.id === courseId && workspace.guide.state.records.undo) ||
          course.context?.records.undo?.label === '自适应减负'
        "
        size="sm"
        :disabled="busy"
        @click="undoPlan"
        >撤销上次计划调整</UiButton
      >
    </article>
    <article v-if="course" class="pane space-y-4 bg-pure-white p-5">
      <h3 class="text-subheading">连续学习 {{ streak }} 天</h3>
      <p class="text-body-sm text-stone">本月防断卡能量 {{ Math.max(0, energy) }} / 2</p>
      <UiButton v-if="canFreeze" :disabled="!!learning.state.saving" @click="protect(yesterday, 'freeze')"
        >保护昨天的打卡</UiButton
      >
      <div v-if="makeup.length" class="flex items-center gap-3">
        <VSelect v-model="makeupDate" label="已完成积压的日期" :items="makeup" />
        <UiButton size="sm" :disabled="!!learning.state.saving || !makeupDate" @click="protect(makeupDate, 'makeup')"
          >补打卡</UiButton
        >
      </div>
    </article>
    <article class="pane space-y-4 bg-pure-white p-5">
      <h3 class="text-subheading">心流时段</h3>
      <p v-if="flow.best" class="text-body-sm text-deep-indigo">
        {{ flow.best.hour }} 点的学习更顺畅，可以把较难的课程安排在这个时段。
      </p>
      <p v-if="flow.hard" class="text-body-sm text-stone">
        {{ flow.hard.hour }} 点较容易感到吃力或疲劳，试着换个时段。
      </p>
      <p v-if="!flow.groups.length" class="text-body-sm text-stone">暂无时段建议</p>
      <div v-for="group in flow.groups" :key="group.hour" class="flex items-center gap-3 text-body-sm">
        <span class="w-12 tabular">{{ group.hour }}:00</span>
        <div class="flex h-3 flex-1 overflow-hidden rounded-full bg-page-cream">
          <span class="bg-deep-indigo" :style="{ width: `${(group.good / group.count) * 100}%` }" /><span
            class="bg-brand-orange"
            :style="{ width: `${(group.hard / group.count) * 100}%` }"
          />
        </div>
        <span class="text-caption text-stone">顺畅 {{ group.good }} · 吃力 {{ group.hard }}</span>
      </div>
    </article>
    <StudyFormDialog
      :open="!!preview"
      title="给计划减一点负担"
      title-id="adaptive-plan-title"
      submit-label="应用减负方案"
      :busy="busy"
      :error="error"
      @update:open="!$event && (preview = null)"
      @submit="apply"
      ><template v-if="preview"
        ><p v-if="reason" class="text-body-sm text-deep-indigo">{{ reason }}</p>
        <p class="text-subheading">
          每日约 {{ preview.limit }} 分钟{{ strategy === 'weekend' ? '，周末适当增加' : '' }}
        </p>
        <div class="rounded-2xl bg-page-cream p-5">
          <p class="text-body-sm">目标日期 {{ preview.oldEnd }} → {{ preview.newEnd }}</p>
          <p class="mt-2 text-body-sm text-stone">从明天开始 · 延后 {{ preview.shifted }} 天</p>
        </div></template
      ></StudyFormDialog
    >
  </section>
</template>

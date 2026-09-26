<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import UiButton from '~/components/UiButton.vue'
import { BUDGET_LABELS, budgetTotal, formatMinutes } from '~/utils/studyProgram'

/** 完整学习计划：总周期、开始日期、每日时间分配与复盘日；并提供实践安排的补全与导入入口。 */
const emit = defineEmits<{ settings: [] }>()
const guide = useGuide()
const program = guide.program
const editing = ref(false)
const form = reactive({ days: 30, startDate: '', video: 60, code: 0, project: 0, recap: 0, lightEvery: 0, lightMinutes: 60 })
const importSelection = ref<File | null>(null)
const importing = ref(false)
const total = computed(() => [form.video, form.code, form.project, form.recap].reduce((n, v) => n + (Number(v) || 0), 0))
const stages = computed(() => guide.practiceModules.value.length)
const summary = computed(() => {
  const p = program.value
  if (!p) return ''
  const parts = (Object.keys(BUDGET_LABELS) as Array<keyof typeof BUDGET_LABELS>).filter(k => p.budget[k] > 0).map(k => `${BUDGET_LABELS[k]} ${formatMinutes(p.budget[k])}`)
  return `共 ${p.days} 天，${p.startDate} 开始；默认每日 ${formatMinutes(budgetTotal(p.budget))}（${parts.join(' · ')}）${p.lightEvery ? `；每 ${p.lightEvery} 天安排 ${formatMinutes(p.lightMinutes)} 轻量复盘` : ''}。`
})

function edit() {
  const p = program.value ?? guide.defaultProgram()
  Object.assign(form, { days: p.days, startDate: p.startDate, ...p.budget, lightEvery: p.lightEvery, lightMinutes: p.lightMinutes })
  editing.value = true
}
function save() {
  const n = (v: unknown) => Math.round(Number(v))
  const ok = guide.setProgram({ days: n(form.days), startDate: form.startDate,
    budget: { video: n(form.video), code: n(form.code), project: n(form.project), recap: n(form.recap) },
    lightEvery: n(form.lightEvery), lightMinutes: n(form.lightMinutes), ...(program.value?.lightTask ? { lightTask: program.value.lightTask } : {}),
    ...(program.value?.calendar ? { calendar: program.value.calendar } : {}) })
  if (ok) editing.value = false
}
async function importFile(selection: File | File[] | null) {
  const file = Array.isArray(selection) ? selection[0] : selection
  if (!file) return
  importing.value = true
  // 先同步组件选中状态，再清空，确保相同文件可以再次选择。
  await nextTick()
  try {
    if (file.size > 20 * 1024 * 1024) { guide.state.error = '文件过大，请选择 20 MB 以内的 JSON 文件。'; return }
    guide.importFile(await file.text())
  } catch {
    guide.state.error = '无法读取实践安排文件，请重新选择。'
  } finally {
    importSelection.value = null
    importing.value = false
  }
}
function complete() {
  if (!guide.configured.value) { guide.state.error = '请先配置 AI 服务，再补全实践安排。'; emit('settings'); return }
  void guide.generatePractice()
}
</script>

<template>
  <section class="mt-5 border-t border-linen pt-4" aria-label="完整学习计划">
    <div class="flex items-center justify-between gap-3">
      <h4 class="text-caption font-bold text-stone">完整学习计划</h4>
      <UiButton v-if="!editing" variant="text" size="sm" :disabled="!!guide.state.busy" @click="edit">{{ program ? '编辑计划' : '设置计划' }}</UiButton>
    </div>
    <p v-if="!editing" class="mt-2 text-body-sm leading-relaxed" :class="program ? '' : 'text-stone'">
      {{ program ? summary : '当前仅安排视频学习。设置学习周期与时间分配，可加入编码、项目与复习任务。' }}
    </p>

    <form v-else class="mt-3 space-y-3 text-body-sm" @submit.prevent="save">
      <div class="grid grid-cols-2 gap-3">
        <VTextField v-model.number="form.days" type="number" min="1" max="1095" step="1" required  label="总天数" />
        <VTextField v-model="form.startDate" type="date" required  label="开始日期" />
      </div>
      <fieldset class="rounded-xl border border-linen p-3">
        <legend class="px-1 text-caption font-bold text-stone">每日时间分配（分钟）</legend>
        <div class="grid grid-cols-2 gap-3">
          <VTextField v-model.number="form.video" type="number" min="0" max="1440" step="5" required  :label="BUDGET_LABELS.video" />
          <VTextField v-model.number="form.code" type="number" min="0" max="1440" step="5" required  :label="BUDGET_LABELS.code" />
          <VTextField v-model.number="form.project" type="number" min="0" max="1440" step="5" required  :label="BUDGET_LABELS.project" />
          <VTextField v-model.number="form.recap" type="number" min="0" max="1440" step="5" required  :label="BUDGET_LABELS.recap" />
        </div>
        <p class="mt-2 text-caption text-stone">合计 {{ formatMinutes(total) }}。各阶段可单独分配时间，观看时间同步用于视频排期。</p>
      </fieldset>
      <div class="grid grid-cols-2 gap-3">
        <VTextField v-model.number="form.lightEvery" type="number" min="0" max="30" step="1" required  label="复盘日间隔（天）" />
        <VTextField v-model.number="form.lightMinutes" type="number" min="5" max="1440" step="5" required  label="复盘日时长（分钟）" />
      </div>
      <p class="text-caption text-stone">复盘日不安排新课，间隔设为 0 可关闭。</p>
      <div class="flex flex-wrap gap-2">
        <UiButton type="submit" variant="dark" size="sm">保存计划</UiButton>
        <UiButton variant="text" size="sm" @click="editing = false">取消</UiButton>
      </div>
    </form>

    <div class="mt-4 rounded-xl bg-page-cream p-3">
      <p class="text-caption leading-relaxed text-graphite">
        实践安排：{{ stages ? `${stages} 个阶段已设置任务与验收清单。` : '尚未设置，可由 AI 根据学习背景与对话生成，或导入 JSON 文件。' }}
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <UiButton size="sm" :disabled="!!guide.state.busy" @click="complete">{{ stages ? 'AI 重新生成' : 'AI 补全' }}</UiButton>
        <div class="min-w-0 flex-1 basis-64">
          <VFileInput v-model="importSelection" accept=".json,application/json" label="导入实践安排" aria-label="选择实践安排文件"
            :disabled="!!guide.state.busy || importing" :loading="importing" @update:model-value="importFile" />
        </div>
      </div>
      <p class="mt-2 text-caption text-stone">支持学习路线文件，或包含 program 与 stages 的实践安排文件。导入后可撤销。</p>
    </div>
  </section>
</template>

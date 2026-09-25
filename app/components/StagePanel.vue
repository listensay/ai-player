<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import type { KnowledgeModule, StageCheck } from '~/types/guide'
import { BUDGET_LABELS, CHECK_LABELS, WORK_LABELS, checkKey, checkPassed, formatMinutes } from '~/utils/studyProgram'

/** 阶段详情：目标、交付物、跳过条件、实践任务与验收清单（验收需填写证据）。 */
const props = defineProps<{ module: KnowledgeModule }>()
const guide = useGuide()
const practice = computed(() => props.module.practice)
const drafts = reactive<Record<string, string>>({})
watch(() => practice.value?.checks.map(c => guide.state.records.checks[checkKey(props.module.id, c.id)]?.evidence ?? ''), () => {
  for (const check of practice.value?.checks ?? []) drafts[check.id] = record(check)?.evidence ?? ''
}, { immediate: true })

function record(check: StageCheck) { return guide.state.records.checks[checkKey(props.module.id, check.id)] }
function passed(check: StageCheck) { return checkPassed(guide.state.records, props.module.id, check) }
function stale(check: StageCheck) { const r = record(check); return !!r?.passed && r.text !== check.text }
function save(check: StageCheck, pass: boolean) {
  const evidence = drafts[check.id] ?? ''
  guide.setCheck(props.module.id, check.id, evidence, pass && !!evidence.trim())
}
function taskDone(taskId: string, title: string) {
  return guide.state.records.entries.some(e => e.moduleId === props.module.id && e.taskId === taskId && e.done && e.title === title)
}
const budget = computed(() => practice.value?.budget ?? guide.program.value?.budget)
const budgetText = computed(() => {
  const b = budget.value
  if (!b) return ''
  return (Object.keys(BUDGET_LABELS) as Array<keyof typeof BUDGET_LABELS>).filter(k => b[k] > 0).map(k => `${BUDGET_LABELS[k]} ${formatMinutes(b[k])}`).join(' · ')
})
</script>

<template>
  <div v-if="practice" class="min-w-0 space-y-4 text-body-sm">
    <p class="text-caption text-stone">
      计划第 {{ practice.startDay }}–{{ practice.endDay }} 天<template v-if="budgetText"> · 每日 {{ budgetText }}</template>
    </p>
    <dl class="grid gap-3 sm:grid-cols-3">
      <div class="min-w-0 rounded-xl bg-page-cream p-3"><dt class="text-caption font-bold text-stone">阶段目标</dt><dd class="mt-1 leading-relaxed [overflow-wrap:anywhere]">{{ practice.goal }}</dd></div>
      <div class="min-w-0 rounded-xl bg-page-cream p-3"><dt class="text-caption font-bold text-stone">阶段交付</dt><dd class="mt-1 leading-relaxed [overflow-wrap:anywhere]">{{ practice.project }}</dd></div>
      <div class="min-w-0 rounded-xl bg-page-cream p-3"><dt class="text-caption font-bold text-stone">可跳过课程的条件</dt><dd class="mt-1 leading-relaxed [overflow-wrap:anywhere]">{{ practice.skipWhen }}</dd></div>
    </dl>

    <VExpansionPanels v-if="practice.tasks.length" class="my-3">
      <VExpansionPanel value="content">
        <VExpansionPanelTitle>实践任务（{{ practice.tasks.filter(t => !t.repeat && taskDone(t.id, t.title)).length }}/{{ practice.tasks.filter(t => !t.repeat).length }} 项已完成）</VExpansionPanelTitle>
        <VExpansionPanelText>
          <ol class="mt-2 divide-y divide-linen">
            <li v-for="task in practice.tasks" :key="task.id" class="py-2.5">
              <p class="flex flex-wrap items-center gap-2">
                <span class="rounded-full bg-page-cream px-2 py-0.5 text-caption font-bold text-graphite">{{ WORK_LABELS[task.kind] }}</span>
                <span class="min-w-0 font-bold [overflow-wrap:anywhere]" :class="!task.repeat && taskDone(task.id, task.title) ? 'text-stone line-through' : ''">{{ task.title }}</span>
                <span v-if="task.repeat" class="text-caption text-stone">每日任务</span>
              </p>
              <p class="mt-1 text-caption leading-relaxed text-graphite [overflow-wrap:anywhere]">{{ task.instructions }}</p>
            </li>
          </ol>
        </VExpansionPanelText>
      </VExpansionPanel>
    </VExpansionPanels>

    <section v-if="practice.checks.length" aria-label="验收清单">
      <h5 class="font-bold">验收清单</h5>
      <p class="mt-1 text-caption text-stone">填写可核对的证据（仓库链接、测试结果、演示说明等）后才能标记通过。</p>
      <ul class="mt-2 space-y-2">
        <li v-for="check in practice.checks" :key="check.id" :data-check-id="check.id" class="rounded-xl border border-linen bg-pure-white p-3">
          <div class="flex flex-wrap items-start gap-2">
            <span class="shrink-0 rounded-full px-2 py-0.5 text-caption font-bold" :class="check.kind === 'project' ? 'bg-deep-indigo/10 text-deep-indigo' : 'bg-page-cream text-graphite'">{{ CHECK_LABELS[check.kind] }}</span>
            <p class="min-w-0 flex-1 leading-relaxed [overflow-wrap:anywhere]">{{ check.text }}</p>
            <span class="shrink-0 text-caption font-bold" :class="passed(check) ? 'text-charcoal-ink' : 'text-stone'">{{ passed(check) ? '已通过' : stale(check) ? '要求已变化，需重新确认' : '待验收' }}</span>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <VTextField v-model="drafts[check.id]" type="text" maxlength="6000" :aria-label="`验收证据：${check.text}`" placeholder="仓库链接、测试结果或演示说明"
              class="min-w-0 flex-1 basis-56"
              @change="save(check, passed(check))" />
            <label class="flex shrink-0 items-center gap-1.5 text-caption font-bold" :class="drafts[check.id]?.trim() ? '' : 'text-stone'">
              <VCheckbox class="shrink-0" :model-value="passed(check)" :disabled="!drafts[check.id]?.trim()"
                @update:model-value="save(check, !!$event)" />通过
            </label>
          </div>
        </li>
      </ul>
    </section>
  </div>
  <p v-else class="text-caption leading-relaxed text-stone">该阶段尚未设置实践任务与验收清单。可在导学的“定制路线”中使用 AI 补全，或导入实践安排。</p>
</template>

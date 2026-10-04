<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import { useLessonPractice } from '~/composables/useLessonPractice'
import { formatTime } from '~/utils/time'
import AiProfileSelector from '~/components/AiProfileSelector.vue'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
import PracticeText from '~/components/PracticeText.vue'
import PracticeAttachmentList from '~/components/PracticeAttachmentList.vue'
import ProgrammingWorkspace from '~/components/ProgrammingWorkspace.vue'
import ProgrammingResults from '~/components/ProgrammingResults.vue'
import { programmingQuestion } from '~/utils/programming'
import { PRACTICE_FILE_ACCEPT } from '~/utils/practiceAttachments'
import { criterionPoints, GRADE_STATUS_LABELS } from '~/utils/practiceGrading'
import { practiceGroup, practiceGroupScore } from '~/utils/practiceSession'
import {
  PRACTICE_KIND_LABELS,
  KNOWLEDGE_LEVEL_LABELS,
  KNOWLEDGE_CATEGORY_LABELS,
  PRACTICE_ATTEMPT_LIMIT,
  isChoiceQuestion,
  selectedPracticeOptions,
} from '~/utils/practice'
import type { MasteryLevel } from '~/types/guide'
import type { PracticeScope, PracticeSource } from '~/types/practice'
import { masteryKey } from '~/utils/learningFeedback'

const props = defineProps<{ practice: ReturnType<typeof useLessonPractice> }>()
const emit = defineEmits<{ settings: []; retry: []; seek: [path: string, seconds: number] }>()
const { state, current, history, sources, configured, hasMaterial, canReview, answerSubmitted } = props.practice
const guide = useGuide()
const contentEl = ref<HTMLElement>()
const feedbackEl = ref<HTMLElement>()
const questionEl = ref<HTMLElement>()
const materialEl = ref<HTMLElement>()
const uploadInput = ref<HTMLInputElement>()
const materialPanel = ref<string>()
const view = ref<'question' | 'feedback' | 'materials'>('question')
const detailPanel = ref<string>()
const attemptIndex = ref(0)
const attempt = computed(() => current.value?.attempts[attemptIndex.value])
const programming = computed(() => programmingQuestion(current.value?.question))
const choice = computed(() =>
  current.value && isChoiceQuestion(current.value.question) ? current.value.question : undefined,
)
const selected = computed(() =>
  current.value ? selectedPracticeOptions(current.value.question, current.value.draft) : [],
)
const selectionItems = [
  { title: '未标记', value: '' },
  { title: '已掌握', value: 'mastered' },
  { title: '不确定', value: 'uncertain' },
  { title: '需要补学', value: 'needs-review' },
]
const results = { solid: '回答正确', partial: '部分正确', retry: '需要复习' }
const daily = state.mode === 'daily'
const sourceLabels = {
  note: '本课笔记',
  subtitle: '字幕',
  supplement: daily ? '今日知识汇总' : '补充材料',
  summary: '知识点总结',
}
const historyItems = computed(() =>
  [...history.value].reverse().map((record) => ({
    value: record.id,
    title: `第 ${practiceGroup(history.value, record).findIndex((item) => item.id === record.id) + 1} 题 · ${PRACTICE_KIND_LABELS[record.question.kind]}`,
    subtitle: `${record.attempts.length ? '已作答' : '未作答'} · ${record.question.concepts.join('、')}`,
  })),
)
const group = computed(() => practiceGroup(history.value, current.value))
const groupScore = computed(() => practiceGroupScore(group.value))
const questionNumber = computed(() => group.value.findIndex((item) => item.id === current.value?.id) + 1)
const lastQuestion = computed(() => questionNumber.value > 0 && questionNumber.value === group.value.length)
const showGroupScore = computed(() => !daily && !!group.value.at(-1)?.attempts.length)
const reachedLimit = computed(
  () => !programming.value && (current.value?.attempts.length ?? 0) >= PRACTICE_ATTEMPT_LIMIT,
)
const canContinue = computed(() => !daily && !!attempt.value && (answerSubmitted.value || reachedLimit.value))
const allQuestionsCompleted = computed(() => groupScore.value.total > 0 && groupScore.value.unanswered === 0)
const nextUnansweredQuestion = computed(() => {
  const following = [...group.value.slice(questionNumber.value), ...group.value.slice(0, questionNumber.value - 1)]
  return following.find((record) => !record.attempts.length)
})
function continueQuestions() {
  if (state.busy || !canContinue.value) return
  const next = nextUnansweredQuestion.value
  if (next) props.practice.select(next.id)
}
const canGenerate = computed(
  () => state.historyReady && !state.busy && configured.value && hasMaterial.value && (!daily || !history.value.length),
)
const submitLabel = computed(() =>
  answerSubmitted.value
    ? '已提交'
    : programming.value
      ? '提交 AI'
      : daily || props.practice.attachments.value.length
        ? current.value?.attempts.length
          ? '重新评分'
          : '提交作业并评分'
        : current.value?.attempts.length
          ? '重新提交'
          : '提交作答',
)
function seekSource(source: PracticeSource) {
  const path = source.path ?? current.value?.path
  if (!path || source.start === undefined) return
  props.practice.close()
  emit('seek', path, source.start)
}
const titleId = `practice-${state.mode}-title`
const completedCount = computed(() => history.value.filter((r) => r.attempts.length).length)
const correctCount = computed(() => history.value.filter((r) => r.attempts.at(-1)?.feedback.result === 'solid').length)
const latestScore = computed(() => current.value?.attempts.at(-1)?.feedback.grade?.score)
const points = computed(() => (current.value ? criterionPoints(current.value.question) : []))
const busyText = computed(() =>
  state.busy === 'test'
    ? '正在执行代码…'
    : state.busy === 'review' && programming.value
      ? '正在测试并提交 AI 评阅…'
      : state.busy === 'loading'
        ? '正在准备知识点…'
        : state.busy === 'generate'
          ? `正在生成练习 ${state.generationProgress}…`
          : state.busy === 'upload'
            ? '正在保存作业文件…'
            : daily || props.practice.attachments.value.length
              ? '正在逐项评阅作业并评分…'
              : '正在评估作答…',
)
const shownScope = computed(() => (current.value ? current.value.scope : state.scope))
function scopeText(scope: PracticeScope | null) {
  return scope ? `${formatTime(scope.start, true)}–${formatTime(scope.end, true)}` : '本课内容'
}
function choose(id: string, checked = true) {
  if (!choice.value) return
  const ids =
    choice.value.kind === 'multiple-choice'
      ? checked
        ? [...new Set([...selected.value, id])]
        : selected.value.filter((v) => v !== id)
      : [id]
  props.practice.updateDraft(JSON.stringify(ids))
}
function navigateQuestion(direction: number) {
  const item = group.value[questionNumber.value - 1 + direction]
  if (item) props.practice.select(item.id)
}
async function showMaterials() {
  view.value = 'materials'
  materialPanel.value = 'materials'
  await nextTick()
  materialEl.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
watch(
  () => [state.open, current.value?.id] as const,
  async ([open, id]) => {
    view.value = id ? 'question' : 'materials'
    materialPanel.value = id ? undefined : 'materials'
    detailPanel.value = undefined
    attemptIndex.value = Math.max(0, (current.value?.attempts.length ?? 1) - 1)
    await nextTick()
    if (!open) return
    contentEl.value?.scrollTo({ top: 0 })
    questionEl.value?.focus({ preventScroll: true })
  },
  { immediate: true },
)
watch(
  () => [current.value?.id, current.value?.attempts.length, current.value?.attempts.at(-1)?.at] as const,
  async ([id, count, at], [previousId, previous, previousAt]) => {
    attemptIndex.value = Math.max(0, (count ?? 1) - 1)
    if (id === previousId && count && (count > (previous ?? 0) || at !== previousAt) && state.open) {
      view.value = 'feedback'
      await nextTick()
      contentEl.value?.scrollTo({ top: 0 })
      feedbackEl.value?.focus({ preventScroll: true })
    }
  },
)
watch(view, async () => {
  detailPanel.value = undefined
  await nextTick()
  contentEl.value?.scrollTo({ top: 0 })
})
function mark(concept: string, value: string) {
  if (current.value) guide.setPracticeMastery(current.value.path, [concept], value as MasteryLevel | '')
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  await props.practice.addAttachments(files)
}
</script>

<template>
  <VDialog
    :model-value="state.open"
    :aria-labelledby="titleId"
    fullscreen
    @update:model-value="!$event && practice.close()"
  >
    <div class="paper-dialog practice-dialog flex h-full min-w-0 flex-col">
      <header class="shrink-0 border-b border-linen bg-pure-white px-5 py-4 sm:px-8">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 :id="titleId" class="text-subheading">{{ daily ? '今日巩固' : '课后练习' }}</h2>
            <p class="mt-1.5 truncate text-body-sm text-stone" :title="state.title">
              {{ state.title }}{{ daily ? '' : ` · ${scopeText(shownScope)}` }}
            </p>
          </div>
          <UiButton variant="text" size="sm" icon title="关闭练习" @click="practice.close()"
            ><AppIcon name="close" :size="20"
          /></UiButton>
        </div>
        <div class="practice-toolbar mt-4 flex flex-wrap items-center gap-2">
          <VSelect
            v-if="history.length && !daily"
            :model-value="state.selectedId"
            aria-label="切换练习"
            :items="historyItems"
            :readonly="!!state.busy"
            class="practice-picker"
            @update:model-value="practice.select($event)"
          >
            <template #selection
              ><span class="font-bold"
                >第 {{ questionNumber || '—' }} 题
                <span class="ml-1 font-normal text-stone">/ {{ group.length }}</span></span
              ></template
            >
            <template #item="{ props: itemProps, item }"
              ><VListItem v-bind="itemProps" :subtitle="item.raw.subtitle"
            /></template>
          </VSelect>
          <div v-if="!daily && group.length > 1 && current" class="flex shrink-0">
            <UiButton
              variant="text"
              size="sm"
              icon
              title="上一题"
              :disabled="!!state.busy || questionNumber <= 1"
              @click="navigateQuestion(-1)"
              ><AppIcon name="chevron-right" class="rotate-180" :size="18"
            /></UiButton>
            <UiButton
              variant="text"
              size="sm"
              icon
              title="下一题"
              :disabled="!!state.busy || lastQuestion"
              @click="navigateQuestion(1)"
              ><AppIcon name="chevron-right" :size="18"
            /></UiButton>
          </div>
          <VBtnToggle
            v-if="current && view !== 'materials'"
            v-model="view"
            mandatory
            variant="text"
            class="practice-view-switch"
            role="group"
            aria-label="练习阅读视图"
          >
            <VBtn value="question" size="small">作答</VBtn>
            <VBtn value="feedback" size="small" :disabled="!attempt">反馈解析</VBtn>
          </VBtnToggle>
          <UiButton v-if="current && view === 'materials'" variant="text" size="sm" @click="view = 'question'"
            ><AppIcon name="arrow-left" :size="16" />返回练习</UiButton
          >
          <UiButton v-else variant="text" size="sm" class="ml-auto" @click="showMaterials">材料与设置</UiButton>
        </div>
      </header>

      <div
        ref="contentEl"
        class="scroll-soft practice-content min-h-0 flex-1 overflow-y-auto"
        :class="{ 'programming-fill': programming && view === 'question' }"
      >
        <div class="practice-reading" :class="{ 'programming-reading': programming && view === 'question' }">
          <section
            v-if="daily && history.length"
            role="status"
            class="mb-6 rounded-xl border border-linen bg-pure-white px-4 py-3 text-body-sm"
          >
            一道综合应用作业 · {{ completedCount ? '已提交' : '待提交'
            }}<span v-if="latestScore !== undefined"> · 最新评分 {{ latestScore }} / 100</span
            ><span v-else-if="completedCount"> · {{ correctCount ? '回答正确' : '查看反馈后可修改作答' }}</span>
          </section>
          <section
            v-if="showGroupScore && view !== 'materials'"
            aria-label="整组得分"
            role="status"
            class="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-linen bg-pure-white px-5 py-4"
          >
            <div>
              <h3 class="text-body font-bold">整组得分</h3>
              <p class="mt-1 text-body-sm text-stone">
                已答 {{ groupScore.completed }} / {{ groupScore.total }} 题
                <span v-if="groupScore.unanswered"> · 未答 {{ groupScore.unanswered }} 题，计 0 分</span>
              </p>
            </div>
            <p class="text-heading font-bold text-deep-indigo">
              {{ groupScore.score }}<span class="ml-2 text-body font-normal text-stone">/ 100 分</span>
            </p>
          </section>
          <section
            v-if="current && view !== 'materials'"
            :key="current.id"
            class="practice-current space-y-7"
            aria-label="当前练习"
          >
            <ProgrammingWorkspace
              v-if="programming && view === 'question'"
              :question="current.question"
              :exercise="programming"
              :draft="current.draft"
              :run="current.codeRun"
              :busy="!!state.busy"
              @draft="practice.updateDraft"
              @execute="practice.executeCode"
              @reset="practice.resetCode"
              @save="practice.persist"
            />
            <div v-if="view === 'question' && !programming" class="space-y-6">
              <div class="flex items-center gap-3">
                <h3
                  ref="questionEl"
                  tabindex="-1"
                  class="practice-section-title rounded outline-none focus-visible:ring-2 focus-visible:ring-deep-indigo"
                >
                  {{ daily ? '综合练习' : PRACTICE_KIND_LABELS[current.question.kind] }}
                </h3>
                <span v-if="current.question.knowledge" class="text-body-sm text-stone">{{
                  KNOWLEDGE_LEVEL_LABELS[current.question.knowledge.level]
                }}</span>
              </div>
              <PracticeText :text="current.question.prompt" class="practice-question-text" />
              <form class="practice-answer space-y-4" @submit.prevent="practice.review()">
                <fieldset v-if="choice" class="min-w-0">
                  <legend class="mb-3 text-body font-bold">
                    {{
                      choice.kind === 'multiple-choice'
                        ? '选择所有正确项'
                        : choice.kind === 'true-false'
                          ? '判断正误'
                          : '选择一个答案'
                    }}
                  </legend>
                  <div v-if="choice.kind === 'multiple-choice'" role="group" aria-label="选择所有正确项">
                    <VCheckbox
                      v-for="option in choice.options"
                      :key="option.id"
                      :model-value="selected.includes(option.id)"
                      :aria-label="`${option.id}. ${option.text}`"
                      :readonly="!!state.busy"
                      hide-details
                      class="practice-option"
                      @update:model-value="choose(option.id, !!$event)"
                    >
                      <template #label
                        ><PracticeText :text="`${option.id}. ${option.text}`" class="text-body-sm"
                      /></template>
                    </VCheckbox>
                  </div>
                  <VRadioGroup
                    v-else
                    :model-value="selected[0]"
                    hide-details
                    :readonly="!!state.busy"
                    aria-label="选择答案"
                    @update:model-value="$event && choose($event)"
                  >
                    <VRadio
                      v-for="option in choice.options"
                      :key="option.id"
                      :value="option.id"
                      :aria-label="option.text"
                      class="practice-option"
                    >
                      <template #label
                        ><PracticeText
                          :text="choice.kind === 'true-false' ? option.text : `${option.id}. ${option.text}`"
                          class="text-body-sm"
                      /></template>
                    </VRadio>
                  </VRadioGroup>
                </fieldset>
                <template v-else>
                  <label :for="`${titleId}-answer`" class="block text-body font-bold">{{
                    daily ? '作业说明或代码' : '你的答案'
                  }}</label>
                  <VTextField
                    v-if="current.question.kind === 'fill-blank'"
                    :id="`${titleId}-answer`"
                    :model-value="current.draft"
                    aria-label="填空答案"
                    maxlength="8000"
                    :readonly="!!state.busy"
                    @update:model-value="practice.updateDraft($event ?? '')"
                  />
                  <VTextarea
                    v-else
                    :id="`${titleId}-answer`"
                    :model-value="current.draft"
                    aria-label="作答内容"
                    maxlength="8000"
                    rows="6"
                    :readonly="!!state.busy"
                    :class="{ 'practice-answer-code': current.question.kind === 'code' }"
                    :placeholder="current.question.kind === 'code' ? '输入代码…' : undefined"
                    @update:model-value="practice.updateDraft($event ?? '')"
                  />
                  <section aria-label="上传作业" class="space-y-3">
                    <input
                      ref="uploadInput"
                      type="file"
                      multiple
                      :accept="PRACTICE_FILE_ACCEPT"
                      aria-label="上传作业文件"
                      class="hidden"
                      :disabled="!!state.busy"
                      @change="upload"
                    />
                    <UiButton
                      variant="ghost"
                      size="sm"
                      :disabled="!!state.busy || reachedLimit"
                      @click="uploadInput?.click()"
                      >添加代码或图片</UiButton
                    >
                    <PracticeAttachmentList
                      v-if="practice.attachments.value.length"
                      :attachments="practice.attachments.value"
                      :record-id="current.id"
                      :load="practice.loadAttachment"
                      removable
                      :disabled="!!state.busy || reachedLimit"
                      @remove="practice.removeAttachment"
                    />
                  </section>
                </template>
              </form>
              <button v-if="attempt" type="button" class="practice-feedback-link" @click="view = 'feedback'">
                <span>{{
                  attempt.feedback.grade
                    ? `作业评分 ${attempt.feedback.grade.score} / 100`
                    : results[attempt.feedback.result]
                }}</span
                ><span class="inline-flex items-center gap-1">查看反馈<AppIcon name="chevron-right" :size="16" /></span>
              </button>
            </div>

            <section
              v-if="attempt && view === 'feedback'"
              ref="feedbackEl"
              tabindex="-1"
              aria-label="答题反馈"
              class="practice-feedback space-y-6 outline-none"
            >
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h3 class="practice-section-title flex items-center gap-3">
                  <span class="practice-result-icon"
                    ><AppIcon :name="attempt.feedback.result === 'solid' ? 'check' : 'note'" :size="22" /></span
                  >{{ attempt.feedback.grade ? '作业评分' : results[attempt.feedback.result] }}
                </h3>
                <VSelect
                  v-if="current.attempts.length > 1"
                  v-model="attemptIndex"
                  aria-label="切换反馈"
                  :items="current.attempts.map((_, index) => ({ title: `第 ${index + 1} 次反馈`, value: index }))"
                  class="w-36 max-w-40 flex-none"
                />
                <span v-else class="text-body-sm text-stone">第 {{ attemptIndex + 1 }} 次反馈</span>
              </div>
              <p
                v-if="attemptIndex !== current.attempts.length - 1 || !answerSubmitted"
                class="text-body-sm text-stone"
              >
                以下为第 {{ attemptIndex + 1 }} 次提交的反馈。
              </p>
              <section v-if="attempt.feedback.grade" aria-label="功能评分" class="space-y-4">
                <p class="text-heading font-bold text-deep-indigo">
                  {{ attempt.feedback.grade.score }}<span class="ml-2 text-body text-stone">/ 100 分</span>
                </p>
                <ol class="space-y-3">
                  <li
                    v-for="item in attempt.feedback.grade.items"
                    :key="item.criterionIndex"
                    class="rounded-xl border border-linen p-4"
                  >
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <h4 class="text-body-sm font-bold">{{ current.question.criteria[item.criterionIndex] }}</h4>
                      <strong class="text-body-sm text-deep-indigo"
                        >{{ item.score }} / {{ points[item.criterionIndex] }} 分</strong
                      >
                    </div>
                    <p
                      class="mt-1 text-caption font-bold"
                      :class="item.status === 'implemented' ? 'text-study-complete' : 'text-error'"
                    >
                      {{ GRADE_STATUS_LABELS[item.status] }}
                    </p>
                    <PracticeText :text="item.evidence" class="mt-2 text-body-sm" />
                    <p class="mt-2 text-caption text-stone">建议：{{ item.improvement }}</p>
                  </li>
                </ol>
              </section>
              <div class="practice-submitted">
                <h4 class="mb-2 text-body-sm font-bold text-stone">本次作答</h4>
                <pre v-if="attempt.answer" class="whitespace-pre-wrap break-words">{{ attempt.answer }}</pre>
                <PracticeAttachmentList
                  v-if="attempt.attachments?.length"
                  class="mt-3"
                  :attachments="attempt.attachments"
                  :record-id="current.id"
                  :load="practice.loadAttachment"
                />
              </div>
              <ProgrammingResults
                v-if="programming && attempt.codeRun"
                :exercise="programming"
                :run="attempt.codeRun"
              />
              <div v-if="attempt.feedback.gaps.length" class="practice-feedback-group">
                <h4 class="mb-3 text-body font-bold">需要调整</h4>
                <ul class="space-y-4">
                  <li v-for="(item, index) in attempt.feedback.gaps" :key="index" class="practice-feedback-item">
                    <span class="practice-point-number">{{ index + 1 }}</span
                    ><PracticeText :text="item" readable class="min-w-0 flex-1" />
                  </li>
                </ul>
              </div>
              <div v-if="attempt.feedback.strengths.length" class="practice-feedback-group">
                <h4 class="mb-3 text-body font-bold">已答对</h4>
                <ul class="space-y-4">
                  <li v-for="(item, index) in attempt.feedback.strengths" :key="index" class="practice-feedback-item">
                    <AppIcon name="check" :size="18" class="mt-1.5 text-deep-indigo" /><PracticeText
                      :text="item"
                      readable
                      class="min-w-0 flex-1"
                    />
                  </li>
                </ul>
              </div>
              <div class="practice-next-step">
                <h4 class="mb-2 text-body font-bold">下一步</h4>
                <PracticeText :text="attempt.feedback.nextStep" readable />
              </div>
            </section>

            <VExpansionPanels v-if="!programming || view !== 'question'" v-model="detailPanel" class="practice-details">
              <VExpansionPanel v-if="view === 'feedback'" value="question">
                <VExpansionPanelTitle>查看题目</VExpansionPanelTitle>
                <VExpansionPanelText><PracticeText :text="current.question.prompt" /></VExpansionPanelText>
              </VExpansionPanel>
              <VExpansionPanel value="answer">
                <VExpansionPanelTitle>参考答案</VExpansionPanelTitle>
                <VExpansionPanelText><PracticeText :text="current.question.referenceAnswer" /></VExpansionPanelText>
              </VExpansionPanel>
              <VExpansionPanel
                v-if="current.question.criteria.length || current.question.knowledge"
                value="requirements"
              >
                <VExpansionPanelTitle>{{
                  daily ? '功能要求与评分标准（100 分）' : '知识点与作答要求'
                }}</VExpansionPanelTitle>
                <VExpansionPanelText>
                  <p class="mb-4 font-medium">{{ current.question.concepts.join(' · ') }}</p>
                  <ul class="list-outside list-disc space-y-1 pl-5 text-body-sm">
                    <li v-for="(criterion, index) in current.question.criteria" :key="criterion">
                      <PracticeText :text="criterion" /><span
                        v-if="daily || current.question.criterionPoints"
                        class="text-caption font-bold text-deep-indigo"
                        >{{ points[index] }} 分</span
                      >
                    </li>
                  </ul>
                  <p v-if="current.question.knowledge" class="mt-3 text-body-sm text-stone">
                    {{ KNOWLEDGE_CATEGORY_LABELS[current.question.knowledge.category] }} ·
                    {{ current.question.knowledge.reason }}
                  </p>
                </VExpansionPanelText>
              </VExpansionPanel>
              <VExpansionPanel v-if="attempt && !daily" value="mastery">
                <VExpansionPanelTitle>记录掌握程度</VExpansionPanelTitle>
                <VExpansionPanelText>
                  <div
                    v-for="concept in current.question.concepts"
                    :key="concept"
                    class="mb-3 flex flex-wrap items-center justify-between gap-3 text-body-sm"
                  >
                    <span>{{ concept }}</span>
                    <VSelect
                      :model-value="guide.state.mastery[masteryKey(current.path, concept)]?.level ?? ''"
                      :aria-label="`练习知识点 ${concept} 掌握程度`"
                      :disabled="!!guide.state.busy"
                      :items="selectionItems"
                      class="w-36 max-w-48"
                      @update:model-value="mark(concept, $event)"
                    />
                  </div>
                </VExpansionPanelText>
              </VExpansionPanel>
              <VExpansionPanel value="sources">
                <VExpansionPanelTitle>参考材料</VExpansionPanelTitle>
                <VExpansionPanelText>
                  <div
                    v-for="source in current.sources.filter(
                      (s) => current!.question.sourceIds.includes(s.id) || attempt?.feedback.sourceIds.includes(s.id),
                    )"
                    :key="source.id"
                    class="mb-4 last:mb-0"
                  >
                    <p class="text-caption font-bold">
                      {{ sourceLabels[source.kind]
                      }}<button
                        v-if="source.start !== undefined"
                        type="button"
                        class="ml-2 hover:text-deep-indigo"
                        @click="seekSource(source)"
                      >
                        回看 {{ formatTime(source.start, true) }}–{{ formatTime(source.end!, true) }}
                      </button>
                    </p>
                    <p class="mt-2 whitespace-pre-wrap break-words text-body-sm leading-relaxed text-graphite">
                      {{ source.text }}
                    </p>
                  </div>
                </VExpansionPanelText>
              </VExpansionPanel>
            </VExpansionPanels>
          </section>

          <section v-show="view === 'materials'" ref="materialEl" aria-label="练习材料与设置">
            <VExpansionPanels v-model="materialPanel">
              <VExpansionPanel value="materials">
                <VExpansionPanelTitle>材料与设置</VExpansionPanelTitle>
                <VExpansionPanelText>
                  <div class="space-y-4">
                    <div class="flex flex-wrap items-center gap-3">
                      <AiProfileSelector
                        class="min-w-0 flex-1"
                        :disabled="!!state.busy || !!guide.state.busy"
                      /><UiButton
                        variant="text"
                        size="sm"
                        @click="
                          () => {
                            practice.close()
                            emit('settings')
                          }
                        "
                        >AI 设置</UiButton
                      >
                    </div>
                    <p class="text-caption text-stone">
                      出题范围：{{ daily ? state.title : scopeText(state.scope) }} ·
                      {{ sources.filter((s) => s.kind === 'summary').length }} 个知识点
                    </p>
                    <p v-if="state.materialNotice" class="text-body-sm text-stone">{{ state.materialNotice }}</p>
                    <VSelect
                      v-if="!daily"
                      v-model="state.programmingPreference"
                      label="练习题型"
                      :items="[
                        { title: '按学习内容选择', value: 'auto' },
                        { title: '代码补全 · JavaScript', value: 'completion' },
                        { title: '功能实现 · JavaScript', value: 'implementation' },
                      ]"
                      :disabled="!!state.busy"
                    />
                    <VSelect
                      v-if="!daily"
                      v-model="state.questionCount"
                      label="每组题数"
                      :items="[3, 5, 8]"
                      :disabled="!!state.busy"
                    />
                    <VTextarea
                      v-if="!daily"
                      v-model="state.supplement"
                      label="补充学习内容"
                      maxlength="4000"
                      rows="4"
                      :disabled="!!state.busy"
                      placeholder="本课概念、示例或代码"
                    />
                    <VExpansionPanels v-if="sources.length">
                      <VExpansionPanel value="preview">
                        <VExpansionPanelTitle
                          >预览发送内容（{{ sources.reduce((n, s) => n + s.text.length, 0) }} 字）</VExpansionPanelTitle
                        >
                        <VExpansionPanelText
                          ><div v-for="source in sources" :key="source.id" class="mb-4 last:mb-0">
                            <p class="text-caption font-bold">
                              {{ sourceLabels[source.kind] }}
                              {{ source.start !== undefined ? formatTime(source.start, true) : '' }}
                            </p>
                            <p class="mt-2 whitespace-pre-wrap break-words text-body-sm text-graphite">
                              {{ source.text }}
                            </p>
                          </div></VExpansionPanelText
                        >
                      </VExpansionPanel>
                    </VExpansionPanels>
                  </div>
                </VExpansionPanelText>
              </VExpansionPanel>
            </VExpansionPanels>
          </section>
        </div>
      </div>

      <footer class="shrink-0 space-y-3 border-t border-linen bg-pure-white px-5 py-4 sm:px-8">
        <p v-if="state.storageError" role="alert" class="text-body-sm text-error">{{ state.storageError }}</p>
        <UiButton v-if="state.storageError && state.historyReady" variant="text" size="sm" @click="practice.persist()"
          >重试保存</UiButton
        >
        <p v-if="state.error" role="alert" class="text-body-sm text-error">{{ state.error }}</p>
        <div v-if="state.busy" role="status" class="flex items-center justify-between gap-3 text-body-sm">
          <span>{{ busyText }}</span
          ><UiButton variant="text" size="sm" @click="practice.cancel()">取消</UiButton>
        </div>
        <div
          v-else-if="state.historyReady && (!configured || !hasMaterial)"
          class="flex flex-wrap items-center justify-between gap-2 text-caption text-stone"
        >
          <span>{{
            !configured
              ? '生成新题需配置 AI 服务。'
              : state.preparedSources !== null
                ? '知识点尚未准备好，请重试准备。'
                : '学习材料不足，请补充学习内容。'
          }}</span>
          <UiButton variant="text" size="sm" @click="showMaterials">{{
            !configured ? '配置 AI' : '查看材料'
          }}</UiButton>
        </div>
        <div v-if="!state.busy" class="flex flex-wrap items-center justify-between gap-3">
          <span class="text-caption text-stone">{{
            current
              ? programming
                ? `最近 ${current.attempts.length} 次提交`
                : reachedLimit
                  ? daily
                    ? '本题反馈已达上限，可查看参考解答'
                    : '本题反馈已达上限，可继续练习'
                  : `本题反馈 ${current.attempts.length} / ${PRACTICE_ATTEMPT_LIMIT} 次`
              : daily
                ? '一道综合练习'
                : `每组 ${state.questionCount} 题`
          }}</span>
          <div class="ml-auto flex flex-wrap gap-2">
            <UiButton v-if="daily" variant="text" :disabled="!!state.busy" @click="practice.close()">{{
              completedCount === history.length && history.length ? '完成' : '稍后继续'
            }}</UiButton>
            <UiButton
              v-if="
                !hasMaterial && (state.error || (state.historyReady && configured && state.preparedSources !== null))
              "
              variant="ghost"
              @click="emit('retry')"
              >重试准备</UiButton
            >
            <UiButton
              v-if="state.error && state.retryGenerationCount"
              variant="ghost"
              :disabled="!canGenerate"
              @click="practice.generate(state.retryGenerationCount)"
              >继续上次出题</UiButton
            >
            <VMenu v-if="current && !daily">
              <template #activator="{ props: menuProps }"
                ><UiButton v-bind="menuProps" variant="ghost" :disabled="!canGenerate"
                  >继续出题<AppIcon name="chevron-down" :size="16" /></UiButton
              ></template>
              <VList aria-label="继续出题"
                ><VListItem title="再练一题" @click="practice.generate()" /><VListItem
                  :title="`再练一组（每组 ${state.questionCount} 题）`"
                  @click="practice.generate(state.questionCount)"
              /></VList>
            </VMenu>
            <UiButton v-if="current && view === 'materials'" variant="dark" @click="view = 'question'"
              >返回练习</UiButton
            >
            <template v-else-if="current && view === 'feedback'">
              <UiButton :variant="canContinue ? 'ghost' : 'dark'" @click="view = 'question'">返回作答</UiButton>
              <UiButton
                v-if="canContinue && nextUnansweredQuestion"
                variant="dark"
                :disabled="!!state.busy"
                @click="continueQuestions"
                >下一题<AppIcon name="chevron-right" :size="16"
              /></UiButton>
              <UiButton
                v-else-if="canContinue && allQuestionsCompleted"
                variant="dark"
                :disabled="!!state.busy"
                @click="practice.close()"
                >完成</UiButton
              >
            </template>
            <UiButton
              v-else-if="canContinue && nextUnansweredQuestion"
              variant="dark"
              :disabled="!!state.busy"
              @click="continueQuestions"
              >下一题<AppIcon name="chevron-right" :size="16"
            /></UiButton>
            <UiButton
              v-else-if="canContinue && allQuestionsCompleted"
              variant="dark"
              :disabled="!!state.busy"
              @click="practice.close()"
              >完成</UiButton
            >
            <UiButton v-else-if="current" variant="dark" :disabled="!canReview" @click="practice.review()">{{
              submitLabel
            }}</UiButton>
            <UiButton v-else variant="dark" :disabled="!canGenerate" @click="practice.generate(state.questionCount)"
              ><AppIcon name="sparkles" :size="16" />生成练习</UiButton
            >
          </div>
        </div>
      </footer>
    </div>
  </VDialog>
</template>

<style scoped>
.practice-picker {
  flex: 0 1 156px;
  min-width: 128px;
}
.practice-view-switch.v-btn-group {
  height: 40px;
  margin-left: 12px;
  padding: 3px;
  gap: 4px;
  border: 1px solid var(--color-linen);
  background: var(--color-pure-white);
  border-radius: var(--radius-pill);
}
.practice-view-switch :deep(.v-btn) {
  height: 32px;
  padding-inline: 16px;
  border-radius: var(--radius-pill);
  font-size: 14px;
  color: var(--color-graphite);
  background: transparent;
}
.practice-view-switch :deep(.v-btn--active) {
  background: var(--color-sunbeam-yellow);
  color: var(--color-charcoal-ink);
}
.practice-view-switch :deep(.v-btn__overlay) {
  background: var(--color-deep-indigo);
}
.practice-view-switch :deep(.v-btn--active:not(:hover):not(:focus-visible) > .v-btn__overlay) {
  opacity: 0;
}
.practice-view-switch :deep(.v-btn:disabled) {
  background: transparent;
  color: var(--color-stone);
  opacity: 0.65;
}
.practice-view-switch :deep(.v-btn:disabled > .v-btn__overlay),
.practice-view-switch :deep(.v-btn:disabled > .v-btn__underlay) {
  opacity: 0;
}
.practice-view-switch :deep(.v-btn:focus-visible) {
  outline: 2px solid var(--color-deep-indigo);
  outline-offset: -2px;
}
.practice-view-switch :deep(.v-btn:focus-visible::after) {
  opacity: 0;
}
.practice-dialog {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.practice-content {
  scroll-padding-block: 32px;
  background: var(--color-pure-white);
}
/* 全屏编程工作台铺满内容区，内部各自滚动。 */
.practice-content.programming-fill {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.practice-reading {
  width: min(100%, 744px);
  margin-inline: auto;
  padding: 32px;
}
.practice-reading.programming-reading {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  padding: 16px;
}
.practice-content.programming-fill .practice-current {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.practice-section-title {
  font-size: 22px;
  line-height: 1.4;
}
.practice-question-text {
  font-size: 17px;
  color: var(--color-charcoal-ink);
}
.practice-answer {
  border-top: 1px solid var(--color-linen);
  padding-top: 24px;
}
.practice-answer :deep(.v-field) {
  font-size: 16px;
}
.practice-answer :deep(.v-field__input) {
  min-height: 54px;
  line-height: 1.8;
}
.practice-answer :deep(.v-label) {
  opacity: 1;
}
.practice-answer :deep(.practice-option .practice-text) {
  font-size: 16px;
}
.practice-feedback-link {
  border: 1px solid var(--color-linen);
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-radius: 12px;
  padding: 14px 16px;
  background: var(--color-page-cream);
  font-size: 14px;
  font-weight: 700;
}
.practice-result-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--color-sunbeam-yellow);
}
.practice-feedback {
  font-size: 16px;
  line-height: 1.9;
}
.practice-submitted {
  border: 1px solid var(--color-linen);
  padding: 16px 20px;
  border-radius: 12px;
  background: var(--color-page-cream);
}
.practice-submitted pre {
  font-family: var(--font-mono);
  font-size: 15px;
  line-height: 1.8;
}
.practice-feedback-group {
  border-top: 1px solid var(--color-linen);
  padding-top: 24px;
}
.practice-feedback-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.practice-point-number {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-top: 3px;
  border-radius: 50%;
  background: var(--color-page-cream);
  color: var(--color-deep-indigo);
  font-size: 12px;
  font-weight: 700;
}
.practice-next-step {
  padding: 20px 24px;
  border-left: 3px solid var(--color-sunbeam-yellow);
  background: var(--color-page-cream);
  border-radius: 0 12px 12px 0;
}
.practice-details :deep(.v-expansion-panel-text) {
  font-size: 16px;
}
@media (max-width: 640px) {
  .practice-reading {
    padding: 24px 20px;
  }
  .practice-section-title {
    font-size: 20px;
  }
  .practice-view-switch.v-btn-group {
    margin-left: auto;
  }
  .practice-toolbar > .ui-button:last-child {
    margin-left: auto;
  }
}
</style>

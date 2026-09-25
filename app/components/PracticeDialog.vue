<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import { useLessonPractice } from '~/composables/useLessonPractice'
import { formatTime } from '~/utils/time'
import AiProfileSelector from '~/components/AiProfileSelector.vue'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
import PracticeText from '~/components/PracticeText.vue'
import { PRACTICE_KIND_LABELS, KNOWLEDGE_LEVEL_LABELS, KNOWLEDGE_CATEGORY_LABELS, isChoiceQuestion, selectedPracticeOptions } from '~/utils/practice'
import type { MasteryLevel } from '~/types/guide'
import { masteryKey } from '~/utils/learningFeedback'

const props = defineProps<{ practice: ReturnType<typeof useLessonPractice> }>()
const emit = defineEmits<{ settings: []; seek: [path: string, seconds: number]; help: [question: string] }>()
const { state, current, history, sources, configured, hasMaterial } = props.practice
const guide = useGuide()
const feedbackEl = ref<HTMLElement>()
const questionEl = ref<HTMLElement>()
const attemptIndex = ref(0)
const materialPanel = ref<string>()
watch(() => current.value?.id, id => { materialPanel.value = id ? undefined : 'content' }, { immediate: true })
const attempt = computed(() => current.value?.attempts[attemptIndex.value])
const choice = computed(() => current.value && isChoiceQuestion(current.value.question) ? current.value.question : undefined)
const selected = computed(() => current.value ? selectedPracticeOptions(current.value.question, current.value.draft) : [])
const selectionItems = [{ title: '未标记', value: '' }, { title: '已掌握', value: 'mastered' }, { title: '不确定', value: 'uncertain' }, { title: '需要补学', value: 'needs-review' }]
function choose(id: string, checked = true) {
  if (!choice.value) return
  const ids = choice.value.kind === 'multiple-choice' ? (checked ? [...new Set([...selected.value, id])] : selected.value.filter(v => v !== id)) : [id]
  props.practice.updateDraft(JSON.stringify(ids))
}
const results = { solid: '作答完整', partial: '作答需补充', retry: '建议复习后重试' }
const sourceLabels = { note: '本课笔记', subtitle: '字幕', supplement: '补充材料' }
watch(() => [current.value?.id, current.value?.attempts.length], () => { attemptIndex.value = Math.max(0, (current.value?.attempts.length ?? 1) - 1) })
watch(() => current.value?.id, async (id, previous) => {
  if (!id || id === previous) return
  await nextTick()
  if (state.open && state.busy !== 'loading') questionEl.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
})
watch(() => current.value?.attempts.length, async (count, previous) => {
  if (count && count > (previous ?? 0) && state.open) { await nextTick(); feedbackEl.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }
})
function mark(concept: string, value: string) {
  if (current.value) guide.setPracticeMastery(current.value.path, [concept], value as MasteryLevel | '')
}
function help() {
  const question = current.value?.question.prompt
  if (!question) return
  props.practice.close(); emit('help', `练习疑问：${question}`.slice(0, 3000))
}
</script>

<template>
  <VDialog :model-value="state.open" aria-labelledby="practice-title" width="840" @update:model-value="!$event && practice.close()">
    <div class="paper-dialog h-[min(90dvh,900px)]">
    <div class="flex h-full min-w-0 flex-col">
      <header class="flex shrink-0 items-center justify-between gap-3 border-b border-linen bg-pure-white px-5 py-4">
        <div class="min-w-0"><h2 id="practice-title" class="text-subheading">课后练习</h2><p class="mt-1 truncate text-caption text-stone">{{ state.title }} · 预计用时 2–5 分钟</p></div>
        <UiButton variant="text" size="sm" icon title="关闭练习" @click="practice.close()"><AppIcon name="close" :size="20" /></UiButton>
      </header>
      <div class="scroll-soft min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
        <AiProfileSelector :disabled="!!state.busy || !!guide.state.busy" />
        <div class="flex flex-wrap items-center justify-between gap-2 text-caption text-stone">
          <p>出题范围：{{ state.scope ? `${formatTime(state.scope.start, true)}–${formatTime(state.scope.end, true)}` : '本课内容' }}</p>
          <UiButton variant="text" size="sm" @click="practice.close(); emit('settings')">AI 设置</UiButton>
        </div>
        <p v-if="state.storageError" role="alert" class="rounded-xl bg-sunbeam-yellow/20 p-3 text-body-sm">{{ state.storageError }}</p>
          <VExpansionPanels v-model="materialPanel" class="my-3">
            <VExpansionPanel value="content">
              <VExpansionPanelTitle>出题材料 · {{ sources.filter(s => s.kind === 'subtitle').length }} 段字幕 / {{ sources.some(s => s.kind === 'note') ? '有笔记' : '无笔记' }}{{ sources.some(s => s.kind === 'supplement') ? ' / 有补充' : '' }}</VExpansionPanelTitle>
              <VExpansionPanelText>
                <div class="mt-3 space-y-3">
                  <p class="text-caption leading-relaxed text-stone">生成练习时，将选取的字幕、本课笔记文字和补充材料发送至所配置的 AI 服务；简答、填空和应用类作答会另发送题目和答案，选择与判断题在本地核对。最多选取 12000 字，不发送视频和图片。笔记含当前尚未保存的文字。</p>
                  <p v-if="state.materialNotice" class="text-body-sm text-stone">{{ state.materialNotice }}</p>
                  <p v-if="!hasMaterial && state.busy !== 'loading'" class="text-body-sm font-medium">学习材料不足。请添加同名 SRT/VTT 字幕、记录笔记，或补充本课概念与示例。</p>
                  <VTextarea v-model="state.supplement" label="补充学习内容" aria-label="补充学习内容" maxlength="4000" rows="4" :disabled="!!state.busy"
                    placeholder="填写本课涉及的概念、示例或代码。" />
                  <VExpansionPanels v-if="sources.length" class="my-3">
                    <VExpansionPanel value="content">
                      <VExpansionPanelTitle>查看将发送的材料（{{ sources.reduce((n, s) => n + s.text.length, 0) }} 字）</VExpansionPanelTitle>
                      <VExpansionPanelText>
                        <div v-for="source in sources" :key="source.id" class="mt-3 border-t border-linen pt-3">
                          <p class="font-bold">{{ sourceLabels[source.kind] }} {{ source.start !== undefined ? formatTime(source.start, true) : '' }}</p>
                          <p class="mt-1 whitespace-pre-wrap break-words text-graphite">{{ source.text }}</p>
                        </div>
                      </VExpansionPanelText>
                    </VExpansionPanel>
                  </VExpansionPanels>
                </div>
              </VExpansionPanelText>
            </VExpansionPanel>
          </VExpansionPanels>
        <div class="flex flex-wrap items-center gap-3">
          <UiButton :disabled="!!state.busy || !configured" @click="practice.generate()">{{ current ? '生成新题' : '生成练习' }}</UiButton>
          <span v-if="!configured" class="text-caption text-stone">请先配置 AI 服务与模型。</span>
          <span v-if="state.busy" role="status" class="text-body-sm">{{ state.busy === 'loading' ? '正在读取本地材料…' : state.busy === 'generate' ? '正在准备练习…' : '正在评估作答…' }}</span>
          <UiButton v-if="state.busy" variant="text" size="sm" @click="practice.cancel()">取消请求</UiButton>
        </div>
        <p v-if="state.error" role="alert" class="rounded-xl border border-error/20 bg-error/5 p-3 text-body-sm text-error">{{ state.error }}</p>
        <VSelect v-if="history.length" :model-value="state.selectedId" label="本课练习记录" aria-label="本课练习记录" :disabled="!!state.busy"
          :items="[{ title: '准备新练习', value: '' }, ...history.map(record => ({ title: `${new Date(record.createdAt).toLocaleString()} · ${record.question.prompt.slice(0, 45)}`, value: record.id }))]"
          @update:model-value="practice.select($event)" />
        <section v-if="current" ref="questionEl" :key="current.id" class="space-y-4 rounded-2xl border border-linen bg-pure-white p-4 sm:p-5" aria-label="当前练习">
          <div class="flex flex-wrap items-center gap-2">
            <VChip color="secondary">{{ PRACTICE_KIND_LABELS[current.question.kind] }}</VChip>
            <VChip v-if="current.question.knowledge" color="ink">目标 · {{ KNOWLEDGE_LEVEL_LABELS[current.question.knowledge.level] }}</VChip>
            <span class="text-caption text-stone">{{ current.question.knowledge ? KNOWLEDGE_CATEGORY_LABELS[current.question.knowledge.category] : '历史题目 · 未分类' }}</span>
          </div>
          <div v-if="current.question.knowledge" class="rounded-xl bg-page-cream p-3">
            <p class="text-caption font-bold">本题重点 · {{ current.question.concepts.join(' / ') }}</p>
            <p class="mt-1 text-body-sm text-graphite">{{ current.question.knowledge.reason }}</p>
          </div>
          <PracticeText :text="current.question.prompt" role="heading" aria-level="3" class="text-body" />
          <ul class="list-outside list-disc space-y-1 pl-5 text-body-sm text-graphite"><li v-for="criterion in current.question.criteria" :key="criterion"><PracticeText :text="criterion" /></li></ul>
          <fieldset v-if="choice" class="min-w-0" :disabled="!!state.busy">
            <legend class="text-body-sm font-bold">{{ choice.kind === 'multiple-choice' ? '选择所有正确项（可多选）' : choice.kind === 'true-false' ? '判断正误' : '选择一个答案' }}</legend>
            <div v-if="choice.kind === 'multiple-choice'" role="group" aria-label="选择所有正确项">
              <VCheckbox v-for="option in choice.options" :key="option.id" :model-value="selected.includes(option.id)" :aria-label="`${option.id}. ${option.text}`"
                :disabled="!!state.busy" class="practice-option" @update:model-value="choose(option.id, !!$event)">
                <template #label><PracticeText :text="`${option.id}. ${option.text}`" class="text-body-sm" /></template>
              </VCheckbox>
            </div>
            <VRadioGroup v-else :model-value="selected[0]" hide-details :disabled="!!state.busy" aria-label="选择答案" @update:model-value="$event && choose($event)">
              <VRadio v-for="option in choice.options" :key="option.id" :value="option.id" :aria-label="option.text" class="practice-option">
                <template #label><PracticeText :text="choice.kind === 'true-false' ? option.text : `${option.id}. ${option.text}`" class="text-body-sm" /></template>
              </VRadio>
            </VRadioGroup>
          </fieldset>
          <VTextField v-else-if="current.question.kind === 'fill-blank'" :model-value="current.draft" label="填空答案" aria-label="填空答案" maxlength="8000" :disabled="!!state.busy"
            placeholder="填写空缺的关键内容，可使用等价表达。" @update:model-value="practice.updateDraft($event ?? '')" />
          <VTextarea v-else :model-value="current.draft" label="作答内容" aria-label="作答内容" maxlength="8000" rows="6" :disabled="!!state.busy"
            :class="{ 'practice-answer-code': current.question.kind === 'code' }"
            :placeholder="current.question.kind === 'code' ? '在此编写代码，仅作书面评阅，不会执行。' : '用自己的话说明思路，表达清楚即可。'" @update:model-value="practice.updateDraft($event ?? '')" />
          <div class="flex flex-wrap items-center gap-3">
            <UiButton variant="dark" :disabled="!!state.busy || current.attempts.length >= 3 || (!choice && !configured)" @click="practice.review()">提交作答</UiButton>
            <p class="text-caption text-stone">本题已反馈 {{ current.attempts.length }}/3 次 · 作答草稿自动保存</p>
          </div>
          <p v-if="current.attempts.length >= 3" class="text-caption text-stone">已达到本题反馈次数上限，可继续修改草稿或生成新题。</p>
          <section v-if="attempt" ref="feedbackEl" aria-label="答题反馈" class="space-y-3 rounded-xl bg-page-cream p-4">
            <VSelect v-model="attemptIndex" label="查看反馈" aria-label="查看第几次反馈" :items="current.attempts.map((_, index) => ({ title: `第 ${index + 1} 次`, value: index }))" />
            <p class="text-body font-bold">{{ results[attempt.feedback.result] }}</p>
            <div v-if="attempt.feedback.strengths.length"><p class="text-caption font-bold">正确要点</p><ul class="mt-1 list-outside list-disc space-y-1 pl-5 text-body-sm"><li v-for="s in attempt.feedback.strengths" :key="s"><PracticeText :text="s" /></li></ul></div>
            <div v-if="attempt.feedback.gaps.length"><p class="text-caption font-bold">待补充内容</p><ul class="mt-1 list-outside list-disc space-y-1 pl-5 text-body-sm"><li v-for="gap in attempt.feedback.gaps" :key="gap"><PracticeText :text="gap" /></li></ul></div>
            <div class="text-body-sm"><strong>下一步：</strong><PracticeText :text="attempt.feedback.nextStep" /></div>
              <VExpansionPanels class="my-3">
                <VExpansionPanel value="content">
                  <VExpansionPanelTitle>本次提交的答案</VExpansionPanelTitle>
                  <VExpansionPanelText>
                    <pre class="mt-2 whitespace-pre-wrap break-words">{{ attempt.answer }}</pre>
                  </VExpansionPanelText>
                </VExpansionPanel>
              </VExpansionPanels>
            <p class="text-caption text-stone">反馈仅针对本次作答。请根据实际理解程度标记知识点：</p>
            <div v-for="concept in current.question.concepts" :key="concept" class="flex flex-wrap items-center justify-between gap-3 text-body-sm">
              <span>{{ concept }}</span>
              <VSelect :model-value="guide.state.mastery[masteryKey(current.path, concept)]?.level ?? ''" :aria-label="`练习知识点 ${concept} 掌握程度`"
                :disabled="!!guide.state.busy" :items="selectionItems" class="w-36 max-w-48" @update:model-value="mark(concept, $event)" />
            </div>
            <UiButton variant="text" size="sm" @click="help">查找基础课</UiButton>
          </section>
            <VExpansionPanels class="my-3">
              <VExpansionPanel value="content">
                <VExpansionPanelTitle>参考答案</VExpansionPanelTitle>
                <VExpansionPanelText>
                  <PracticeText class="mt-3" :text="current.question.referenceAnswer" />
                </VExpansionPanelText>
              </VExpansionPanel>
            </VExpansionPanels>
            <VExpansionPanels class="my-3">
              <VExpansionPanel value="content">
                <VExpansionPanelTitle>题目与反馈的依据</VExpansionPanelTitle>
                <VExpansionPanelText>
                  <div v-for="source in current.sources.filter(s => current!.question.sourceIds.includes(s.id) || attempt?.feedback.sourceIds.includes(s.id))" :key="source.id" class="mt-3 border-t border-linen pt-3">
                    <p class="text-caption font-bold">{{ sourceLabels[source.kind] }}<button v-if="source.start !== undefined" type="button" class="ml-2 hover:text-deep-indigo" @click="practice.close(); emit('seek', current.path, source.start)">回看 {{ formatTime(source.start, true) }}–{{ formatTime(source.end!, true) }}</button></p>
                    <p class="mt-2 whitespace-pre-wrap break-words leading-relaxed text-graphite">{{ source.text }}</p>
                  </div>
                </VExpansionPanelText>
              </VExpansionPanel>
            </VExpansionPanels>
        </section>
        <p class="text-caption text-stone">每门课程保留最近 20 道练习，每题最多记录 3 次反馈。</p>
      </div>
    </div>
    </div>
  </VDialog>
</template>

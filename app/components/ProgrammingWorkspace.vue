<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { PracticeQuestion, ProgrammingExercise, ProgrammingRun } from '~/types/practice'
import { PROGRAMMING_MODES } from '~/utils/programming'
import ProgrammingEditor from '~/components/ProgrammingEditor.vue'
import ProgrammingResults from '~/components/ProgrammingResults.vue'
import PracticeText from '~/components/PracticeText.vue'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'
const props = defineProps<{
  question: PracticeQuestion
  exercise: ProgrammingExercise
  draft: string
  run?: ProgrammingRun
  busy: boolean
}>()
const emit = defineEmits<{
  draft: [value: string]
  execute: []
  reset: []
  save: []
}>()
const root = ref<HTMLElement>(),
  width = ref(40),
  collapsed = ref(false),
  resultsHidden = ref(false),
  confirmReset = ref(false)
const location = ref<{ line: number; column?: number; nonce: number }>()
const stale = computed(() => !!props.run && props.run.code !== props.draft)
const details = ref<string>()
function locate(value: { line: number; column?: number }) {
  location.value = { ...value, nonce: Date.now() }
}
function drag(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
}
function resize(event: PointerEvent) {
  if (!(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId) || !root.value) return
  const rect = root.value.getBoundingClientRect()
  width.value = Math.max(28, Math.min(60, ((event.clientX - rect.left) / rect.width) * 100))
}
function finish(event: PointerEvent) {
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
}
function keyboardResize(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  width.value =
    event.key === 'Home'
      ? 28
      : event.key === 'End'
        ? 60
        : Math.max(28, Math.min(60, width.value + (event.key === 'ArrowLeft' ? -2 : 2)))
}
function restoreCode() {
  emit('reset')
  confirmReset.value = false
}
onBeforeUnmount(() => {
  confirmReset.value = false
})
</script>
<template>
  <div
    ref="root"
    class="programming-workspace"
    :class="{ 'requirements-collapsed': collapsed }"
    :style="{ '--requirements-width': `${width}%` }"
  >
    <section v-if="!collapsed" aria-label="编程题需求" class="requirements scroll-soft">
      <div class="mb-4 flex items-center justify-between gap-2">
        <h3 class="text-subheading">{{ PROGRAMMING_MODES[exercise.mode] }}</h3>
        <UiButton variant="text" size="sm" icon title="收起题目" @click="collapsed = true"
          ><AppIcon name="close" :size="18"
        /></UiButton>
      </div>
      <PracticeText :text="question.prompt" />
      <h4 class="mb-2 mt-5 font-bold">接口约定</h4>
      <PracticeText :text="exercise.signature" />
      <h4 class="mb-2 mt-5 font-bold">实现要求</h4>
      <ol class="list-decimal space-y-2 pl-5">
        <li v-for="item in question.criteria" :key="item"><PracticeText :text="item" /></li>
      </ol>
      <VExpansionPanels v-model="details" class="mt-5">
        <VExpansionPanel v-if="exercise.hints.length" value="hints"
          ><VExpansionPanelTitle>提示</VExpansionPanelTitle
          ><VExpansionPanelText
            ><PracticeText v-for="hint in exercise.hints" :key="hint" :text="hint" class="mb-3" /></VExpansionPanelText
        ></VExpansionPanel>
        <VExpansionPanel value="reference"
          ><VExpansionPanelTitle>参考答案</VExpansionPanelTitle
          ><VExpansionPanelText>
            <pre class="mb-4">{{ exercise.referenceCode }}</pre>
            <PracticeText :text="question.referenceAnswer" /></VExpansionPanelText
        ></VExpansionPanel>
      </VExpansionPanels>
    </section>
    <div
      v-if="!collapsed"
      role="separator"
      aria-label="调整题目与编辑器宽度"
      aria-orientation="vertical"
      :aria-valuenow="Math.round(width)"
      :aria-valuemin="28"
      :aria-valuemax="60"
      tabindex="0"
      class="resize-handle"
      @pointerdown="drag"
      @pointermove="resize"
      @pointerup="finish"
      @keydown="keyboardResize"
    />
    <section class="code-pane" aria-label="编程作答">
      <div class="editor-titlebar">
        <div class="editor-file"><span class="language-mark" aria-hidden="true">JS</span>solution.js</div>
        <span class="editor-language">JavaScript</span>
      </div>
      <div class="code-toolbar">
        <button
          v-if="collapsed"
          type="button"
          class="ide-button ide-icon-button"
          title="展开题目"
          aria-label="展开题目"
          @click="collapsed = false"
        >
          <AppIcon name="panel-left-open" :size="16" />
        </button>
        <button type="button" class="ide-button ide-button-test" :disabled="busy" @click="emit('execute')">
          <AppIcon name="check" :size="15" />测试
        </button>
        <button
          type="button"
          class="ide-button ide-icon-button reset-code"
          :disabled="busy"
          title="恢复初始代码"
          aria-label="恢复初始代码"
          @click="confirmReset = true"
        >
          <AppIcon name="reset" :size="15" />
        </button>
      </div>
      <div class="editor-space">
        <ProgrammingEditor
          :model-value="draft"
          :readonly="busy"
          :location="location"
          @update:model-value="emit('draft', $event)"
          @save="emit('save')"
        />
      </div>
      <div class="result-space" :class="{ 'results-hidden': resultsHidden }">
        <ProgrammingResults
          :exercise="exercise"
          :run="run"
          :stale="stale"
          collapsible
          :collapsed="resultsHidden"
          @toggle="resultsHidden = !resultsHidden"
          @locate="locate"
        />
      </div>
    </section>
    <VDialog v-model="confirmReset" max-width="400"
      ><div class="paper-dialog bg-pure-white p-6">
        <h3 class="mb-3 text-subheading">恢复初始代码？</h3>
        <p class="mb-5 text-body-sm">当前草稿将被替换，已提交的历史记录保留。</p>
        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" @click="confirmReset = false">取消</UiButton
          ><UiButton :disabled="busy" @click="restoreCode">恢复初始代码</UiButton>
        </div>
      </div></VDialog
    >
  </div>
</template>
<style scoped>
.programming-workspace {
  display: grid;
  grid-template-columns: minmax(0, var(--requirements-width)) 8px minmax(0, 1fr);
  height: max(480px, calc(92dvh - 260px));
  max-height: 720px;
  border: 1px solid var(--color-linen);
  border-radius: 16px;
  overflow: hidden;
  background: var(--color-pure-white);
}
.requirements {
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: 20px;
  font-size: 14px;
}
.requirements-collapsed {
  grid-template-columns: minmax(0, 1fr);
}
.resize-handle {
  cursor: col-resize;
  touch-action: none;
  background: #252526;
  border-left: 1px solid var(--color-linen);
  border-right: 1px solid #333333;
}
.resize-handle:hover,
.resize-handle:focus-visible {
  background: #007acc;
  outline: none;
}
.code-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #1e1e1e;
  color: #cccccc;
  color-scheme: dark;
}
.editor-titlebar {
  display: flex;
  align-items: center;
  flex: 0 0 35px;
  background: #252526;
  border-bottom: 1px solid #2b2b2b;
  font-size: 12px;
}
.editor-file {
  display: flex;
  align-items: center;
  gap: 9px;
  align-self: stretch;
  padding: 0 16px;
  background: #1e1e1e;
  border-top: 1px solid #75beff;
  border-right: 1px solid #2b2b2b;
}
.language-mark {
  color: #e8cb69;
  font-size: 11px;
  font-weight: 700;
}
.editor-language {
  margin-left: auto;
  padding-inline: 14px;
  color: #9d9d9d;
}
.code-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid #2b2b2b;
}
.ide-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #cccccc;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.ide-button:hover:not(:disabled) {
  background: #343434;
}
.ide-button-test {
  border-color: #454545;
  background: #313131;
}
.ide-icon-button {
  width: 28px;
  padding: 0;
}
.reset-code {
  margin-left: auto;
}
.ide-button:focus-visible {
  outline: 1px solid #75beff;
  outline-offset: 2px;
}
.ide-button:disabled {
  opacity: 0.45;
  cursor: default;
}
.editor-space {
  flex: 1;
  min-height: 180px;
}
.result-space {
  flex: 0 1 44%;
  min-height: 200px;
  overflow: hidden;
}
.result-space.results-hidden {
  flex: 0 0 36px;
  min-height: 36px;
}
pre {
  font-family: var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
}
@media (max-width: 900px) {
  .requirements {
    padding: 14px;
  }
  .programming-workspace {
    grid-template-columns: minmax(0, var(--requirements-width)) 8px minmax(0, 1fr);
  }
  .requirements-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

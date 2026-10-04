<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { VTab, VTabs } from 'vuetify/components'
import { Terminal, ChevronDown, ChevronUp, Check, X, Clock, CircleAlert } from '@lucide/vue'
import type { ProgrammingExercise, ProgrammingRun, ProgrammingCaseResult } from '~/types/practice'
const props = defineProps<{
  exercise: ProgrammingExercise
  run?: ProgrammingRun
  stale?: boolean
  collapsible?: boolean
  collapsed?: boolean
}>()
const emit = defineEmits<{ locate: [location: { line: number; column?: number }]; toggle: [] }>()
const selectedId = ref(''),
  tab = ref('test')
const panelId = useId()
const tabs = [
  { value: 'test', label: '测试详情' },
  { value: 'output', label: '程序输出' },
  { value: 'error', label: '运行错误' },
]
const labels = { passed: '通过', failed: '未通过', error: '运行错误', timeout: '执行超时' }
const statusIcons = { passed: Check, failed: X, error: CircleAlert, timeout: Clock }
const passed = computed(() => props.run?.cases.filter((item) => item.status === 'passed').length ?? 0)
const allPassed = computed(() => !!props.run?.cases.length && passed.value === props.run.cases.length)
const selected = computed(() => props.run?.cases.find((c) => c.id === selectedId.value))
const test = computed(() => props.exercise.tests.find((t) => t.id === selectedId.value))
watch(
  () => props.run,
  (run) => {
    selectedId.value = run?.cases.find((c) => c.status !== 'passed')?.id ?? run?.cases[0]?.id ?? ''
    tab.value = 'test'
  },
  { immediate: true },
)
function locate(item: ProgrammingCaseResult) {
  if (item.line) emit('locate', { line: item.line, column: item.column })
}
</script>
<template>
  <section aria-label="代码运行结果" class="programming-results">
    <header class="result-header">
      <div class="result-title">
        <Terminal :size="14" aria-hidden="true" />{{ run?.mode === 'test' ? '测试结果' : '运行结果' }}
      </div>
      <span v-if="run" role="status" class="run-status" :class="{ passed: allPassed && !stale, stale }">
        <template v-if="stale">代码已修改，需重新测试</template>
        <template v-else
          ><Check v-if="allPassed" :size="13" aria-hidden="true" />通过 {{ passed }} / {{ run.cases.length }}</template
        >
      </span>
      <button
        v-if="collapsible"
        type="button"
        class="panel-toggle"
        :aria-label="collapsed ? '展开运行结果' : '收起运行结果'"
        :title="collapsed ? '展开运行结果' : '收起运行结果'"
        :aria-expanded="!collapsed"
        :aria-controls="`${panelId}-body`"
        @click="emit('toggle')"
      >
        <component :is="collapsed ? ChevronUp : ChevronDown" :size="16" aria-hidden="true" />
      </button>
    </header>
    <div v-show="!collapsed" :id="`${panelId}-body`" class="result-body">
      <VTabs v-model="tab" class="result-tabs" height="36" color="#e7e7e7" hide-slider aria-label="结果内容">
        <VTab
          v-for="item in tabs"
          :id="`${panelId}-${item.value}-tab`"
          :key="item.value"
          :value="item.value"
          :aria-controls="`${panelId}-content`"
          :ripple="false"
          :rounded="0"
          >{{ item.label
          }}<span v-if="item.value === 'error' && selected?.error" class="error-dot" aria-label="有运行错误"
        /></VTab>
      </VTabs>
      <div v-if="run" class="case-list" aria-label="选择测试结果">
        <button
          v-for="item in run.cases"
          :key="item.id"
          type="button"
          class="case-button"
          :class="[{ 'selected-case': selectedId === item.id }, item.status]"
          :aria-pressed="selectedId === item.id"
          :aria-label="`${exercise.tests.find((t) => t.id === item.id)?.name} · ${labels[item.status]}`"
          :title="labels[item.status]"
          @click="selectedId = item.id"
        >
          <component :is="statusIcons[item.status]" :size="13" class="case-status" aria-hidden="true" />
          {{ exercise.tests.find((t) => t.id === item.id)?.name }}
        </button>
      </div>
      <div
        :id="`${panelId}-content`"
        role="tabpanel"
        :aria-labelledby="`${panelId}-${tab}-tab`"
        tabindex="0"
        class="result-content"
      >
        <p v-if="!run" class="empty-result">暂无运行结果</p>
        <template v-else-if="selected && test">
          <dl v-if="tab === 'test'" class="test-values">
            <dt>输入参数</dt>
            <dd>
              <pre>{{ JSON.stringify(test.args) }}</pre>
            </dd>
            <dt>预期输出</dt>
            <dd>
              <pre>{{ JSON.stringify(test.expected) }}</pre>
            </dd>
            <dt>实际输出</dt>
            <dd :class="{ 'error-text': selected.status !== 'passed', 'passed-text': selected.status === 'passed' }">
              <pre>{{ selected.actual || selected.error || '无输出' }}</pre>
            </dd>
          </dl>
          <pre v-else-if="tab === 'output'" :class="{ 'empty-result': !selected.output }">{{
            selected.output || '无程序输出'
          }}</pre>
          <div v-else>
            <pre :class="selected.error ? 'error-text' : 'empty-result'">{{ selected.error || '无运行错误' }}</pre>
            <button v-if="selected.line && !stale" type="button" class="locate-error" @click="locate(selected)">
              定位第 {{ selected.line }} 行
            </button>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
<style scoped>
.programming-results {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: #1e1e1e;
  color: #cccccc;
  color-scheme: dark;
  font-size: 12px;
  line-height: 1.6;
  border-top: 1px solid #3a3a3a;
}
.result-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  flex-wrap: wrap;
  min-height: 35px;
  gap: 6px 12px;
  padding: 4px 12px;
  background: #252526;
}
.result-title,
.run-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.result-title {
  color: #bbbbbb;
  white-space: nowrap;
}
.run-status {
  color: #e5bd73;
  font-size: 11px;
}
.run-status.passed,
.passed-text,
.passed .case-status {
  color: #89d185;
}
.run-status.stale {
  color: #a0a0a0;
}
.panel-toggle {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-left: auto;
  border-radius: 4px;
  color: #bbbbbb;
  cursor: pointer;
}
.panel-toggle:hover {
  background: #383838;
  color: #ffffff;
}
.result-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.result-tabs {
  flex: 0 0 36px;
  border-bottom: 1px solid #303030;
  padding-inline: 4px;
  color: #9d9d9d;
}
.result-tabs :deep(.v-tab) {
  min-width: 0;
  padding-inline: 12px;
  font-size: 12px;
  font-weight: 400 !important;
  border-radius: 0;
  border-bottom: 1px solid transparent;
  background: transparent;
}
.result-tabs :deep(.v-tab[aria-selected='true']) {
  border-bottom-color: #75beff;
}
.result-tabs :deep(.v-btn__content) {
  gap: 6px;
}
.result-tabs :deep(.v-btn__overlay) {
  background: #cccccc;
}
.result-tabs :deep(.v-btn--active > .v-btn__overlay) {
  opacity: 0;
}
.error-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #f48771;
}
.case-list {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  overflow-x: auto;
  padding: 10px 14px 0;
}
.case-button {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  min-height: 25px;
  padding: 2px 9px;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #9d9d9d;
  white-space: nowrap;
  cursor: pointer;
}
.case-button:hover {
  background: #292929;
  color: #cccccc;
}
.case-button.selected-case {
  background: #2b2b2b;
  border-color: #454545;
  color: #e7e7e7;
}
.failed .case-status,
.error .case-status,
.error-text {
  color: #f48771;
}
.timeout .case-status {
  color: #e5bd73;
}
.result-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 16px;
}
.case-list,
.result-content {
  scrollbar-width: thin;
  scrollbar-color: #454545 transparent;
}
.test-values {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 8px 14px;
}
.test-values dt,
.empty-result {
  color: #9d9d9d;
}
.test-values dd {
  min-width: 0;
  margin: 0;
}
pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
}
.locate-error {
  margin-top: 8px;
  color: #75beff;
  cursor: pointer;
}
.locate-error:hover {
  text-decoration: underline;
}
button:focus-visible,
.result-content:focus-visible {
  outline: 1px solid #75beff;
  outline-offset: -1px;
}
</style>

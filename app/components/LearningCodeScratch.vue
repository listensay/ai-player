<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import ProgrammingEditor from './ProgrammingEditor.vue'
import UiButton from './UiButton.vue'
import { PROGRAMMING_LANGUAGES, isProgrammingLanguage } from '~/utils/programmingLanguages'
import type { ProgrammingLanguage } from '~/utils/programmingLanguages'
import type { ProgrammingExercise } from '~/types/practice'
import { runProgrammingSandbox } from '~/utils/programmingRunner'
const props = defineProps<{ code: string; language: string }>()
const emit = defineEmits<{ save: [code: string, language: string] }>()
const code = ref(props.code),
  language = ref<ProgrammingLanguage>(isProgrammingLanguage(props.language) ? props.language : 'javascript')
const busy = ref(false),
  output = ref(''),
  error = ref(''),
  lastCode = ref('')
const stale = computed(() => !!output.value && code.value !== lastCode.value)
let request: AbortController | undefined
async function execute() {
  if (busy.value) return
  if (code.value.length > 30000) {
    error.value = '代码最多 30000 字。'
    return
  }
  busy.value = true
  error.value = ''
  output.value = ''
  lastCode.value = code.value
  request = new AbortController()
  const exercise: ProgrammingExercise = {
    version: 1,
    language: 'javascript',
    mode: 'implementation',
    functionName: '__learningFrame__',
    signature: '在函数内运行截图代码；使用 console.log 查看输出。',
    starterCode: '// scratch',
    referenceCode: 'function __learningFrame__() { return null }',
    hints: [],
    tests: [
      { id: 'run', name: '运行', kind: 'normal', example: true, args: [], expected: null },
      { id: 'unused', name: '边界', kind: 'boundary', example: false, args: [null], expected: null },
    ],
  }
  try {
    const result = await runProgrammingSandbox(
      { exercise, code: `function __learningFrame__() {\n${code.value}\n; return null;\n}`, mode: 'run' },
      request.signal,
    )
    const first = result.cases[0]!
    output.value =
      [first.output, first.error, first.actual && first.actual !== 'null' ? `返回值：${first.actual}` : '']
        .filter(Boolean)
        .join('\n') || '运行完成，没有控制台输出。'
  } catch (reason) {
    error.value = (reason as Error).message
  } finally {
    busy.value = false
  }
}
onBeforeUnmount(() => request?.abort())
</script>
<template>
  <section aria-label="截图代码练习台" class="space-y-3 rounded-2xl border border-linen p-3">
    <h3 class="font-bold">截图代码练习台</h3>
    <VSelect
      v-model="language"
      label="代码语言"
      :disabled="busy"
      :items="Object.entries(PROGRAMMING_LANGUAGES).map(([value, item]) => ({ title: item.name, value }))"
      hide-details
      density="compact"
    />
    <div class="scratch-editor">
      <ProgrammingEditor v-model="code" :language="language" :readonly="busy" @save="emit('save', code, language)" />
    </div>
    <p class="text-caption text-stone">
      JavaScript
      可在隔离沙箱内手动运行（无网络、文件或桌面权限）。其他语言支持编辑并保存至笔记；此处不自动执行本机程序。
    </p>
    <div class="flex flex-wrap gap-2">
      <UiButton v-if="language === 'javascript'" size="sm" :disabled="busy || !code.trim()" @click="execute"
        >在沙箱运行</UiButton
      >
      <UiButton v-if="busy" size="sm" variant="ghost" @click="request?.abort()">停止</UiButton>
      <UiButton size="sm" variant="ghost" :disabled="busy" @click="emit('save', code, language)">代码存入笔记</UiButton>
    </div>
    <p v-if="stale" class="text-caption text-stone">代码已修改，以下是上次运行结果。</p>
    <pre
      v-if="output"
      class="scroll-soft max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-cream-deep p-3 text-caption"
      >{{ output }}</pre>
    <p v-if="error" role="alert" class="text-caption text-error">{{ error }}</p>
  </section>
</template>
<style scoped>
.scratch-editor {
  height: 320px;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
</style>

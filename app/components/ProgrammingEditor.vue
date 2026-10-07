<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { editor } from 'monaco-editor'
import { startPerformanceMeasure } from '~/utils/performance'
import { programmingFilename, programmingLanguageName } from '~/utils/programmingLanguages'
import type { ProgrammingLanguage } from '~/utils/programmingLanguages'
import UiButton from '~/components/UiButton.vue'
const props = defineProps<{
  modelValue: string
  language: ProgrammingLanguage
  readonly?: boolean
  location?: { line: number; column?: number; nonce: number }
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; save: [] }>()
const root = ref<HTMLElement>(),
  error = ref(''),
  loading = ref(true)
let instance: editor.IStandaloneCodeEditor | undefined, model: editor.ITextModel | undefined
let subscription: { dispose(): void } | undefined,
  disposed = false,
  syncing = false
function syncValue(value: string) {
  if (!instance || disposed || instance.getValue() === value) return
  syncing = true
  try {
    instance.setValue(value)
  } finally {
    syncing = false
  }
}
async function initialize() {
  error.value = ''
  loading.value = true
  const measure = startPerformanceMeasure('programming-ready')
  try {
    const { monaco, prepareLanguage } = await import('~/utils/codeEditor')
    await prepareLanguage(props.language)
    if (disposed || !root.value) return
    model = monaco.editor.createModel(
      props.modelValue,
      props.language,
      monaco.Uri.parse(`inmemory://practice/${crypto.randomUUID()}/${programmingFilename(props.language)}`),
    )
    model.updateOptions({ tabSize: 2, insertSpaces: true })
    instance = monaco.editor.create(root.value, {
      model,
      theme: 'vs-dark',
      automaticLayout: true,
      readOnly: props.readonly,
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      padding: { top: 12, bottom: 12 },
      ariaLabel: `${programmingLanguageName(props.language)} 代码编辑器`,
      accessibilitySupport: 'auto',
      fixedOverflowWidgets: true,
    })
    subscription = instance.onDidChangeModelContent(() => {
      if (syncing) return
      emit('update:modelValue', instance!.getValue())
      // The parent can reject an edit (for example, the code size limit). In that
      // case its prop does not change, so the prop watcher alone cannot resync.
      void nextTick(() => {
        syncValue(props.modelValue)
      })
    })
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'))
    if (import.meta.env.MODE === 'desktop-smoke') window.__AI_PLAYER_SMOKE_EDITOR__ = instance
    measure.finish()
  } catch {
    error.value = '代码编辑器加载失败。'
  } finally {
    measure.cancel()
    loading.value = false
  }
}
onMounted(initialize)
watch(() => props.modelValue, syncValue)
watch(
  () => props.readonly,
  (value) => instance?.updateOptions({ readOnly: value }),
)
watch(
  () => props.location,
  (value) => {
    if (!value || !instance) return
    instance.revealLineInCenter(value.line)
    instance.setPosition({ lineNumber: value.line, column: value.column ?? 1 })
    instance.focus()
  },
)
onBeforeUnmount(() => {
  disposed = true
  subscription?.dispose()
  if (import.meta.env.MODE === 'desktop-smoke' && window.__AI_PLAYER_SMOKE_EDITOR__ === instance)
    window.__AI_PLAYER_SMOKE_EDITOR__ = undefined
  instance?.dispose()
  model?.dispose()
})
</script>
<template>
  <div class="programming-editor relative h-full min-h-[180px]">
    <div ref="root" class="absolute inset-0" />
    <p v-if="loading" role="status" class="editor-message absolute inset-0 p-4 text-body-sm">正在加载编辑器…</p>
    <div v-if="error" role="alert" class="editor-message absolute inset-0 p-4">
      <p class="editor-error mb-3 text-body-sm">{{ error }}</p>
      <UiButton size="sm" class="editor-retry" @click="initialize">重试</UiButton>
    </div>
  </div>
</template>
<style scoped>
.programming-editor,
.editor-message {
  background: #1e1e1e;
  color: #cccccc;
  color-scheme: dark;
}
.editor-message {
  color: #9d9d9d;
}
.editor-error {
  color: #f48771;
}
.editor-retry.ui-button {
  background: #313131;
  border-color: #454545;
  border-radius: 4px;
  color: #cccccc;
}
</style>

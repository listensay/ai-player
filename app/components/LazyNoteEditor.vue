<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { Component } from 'vue'
import type { VideoEntry } from '~/types/course'
import type { NoteEditorHandle } from '~/types/note'
import UiButton from './UiButton.vue'

const props = defineProps<{ video: VideoEntry; courseId: string; active: boolean }>()
const emit = defineEmits<{ seek: [seconds: number] }>()
const component = shallowRef<Component>()
const editor = shallowRef<NoteEditorHandle>()
const error = ref('')
let disposed = false
let pending: Promise<void> | undefined
function whenReady(): Promise<void> {
  if (disposed) return Promise.reject(new Error('课节已切换，请重试。'))
  if (pending) return pending
  error.value = ''
  pending = (async () => {
    component.value ??= (await import('./NoteEditor.vue')).default
    await nextTick()
    if (disposed || !editor.value) throw new Error('课节已切换，请重试。')
    await editor.value.whenReady()
    if (disposed) throw new Error('课节已切换，请重试。')
  })().catch(reason => { error.value = (reason as Error).message; throw reason })
    .finally(() => { pending = undefined })
  return pending
}
watch(() => props.active, active => { if (active) void whenReady().catch(() => {}) }, { immediate: true, flush: 'post' })
onBeforeUnmount(() => { disposed = true })
defineExpose({ whenReady, hasUnsavedChanges: () => editor.value?.hasUnsavedChanges() ?? false,
  save: async () => { await editor.value?.save() },
  insertTimestamp: (seconds: number) => editor.value?.insertTimestamp(seconds),
  insertInline: (text: string) => editor.value?.insertInline(text),
  insertScreenshot: async (blob: Blob, seconds: number, ratio?: number) => { await editor.value?.insertScreenshot(blob, seconds, ratio) },
  setPlayhead: (seconds: number) => editor.value?.setPlayhead(seconds),
  focus: () => editor.value?.focus(), getMarkdown: () => editor.value?.getMarkdown(),
} satisfies NoteEditorHandle)
</script>

<template>
  <component v-if="component" :is="component" ref="editor" :video="video" :course-id="courseId"
    @seek="emit('seek', $event)">
    <template #actions><slot name="actions" /></template>
  </component>
  <section v-else class="pane flex-1 p-4" aria-label="笔记">
    <p :role="error ? 'alert' : 'status'">{{ error || '正在加载笔记编辑器…' }}</p>
    <UiButton v-if="error" class="mt-3" @click="whenReady().catch(() => {})">重试加载</UiButton>
  </section>
</template>

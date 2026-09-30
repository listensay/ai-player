<script setup lang="ts">
import { reactive, watch } from 'vue'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'
import type { PracticeAttachment, PracticeAttachmentContent } from '~/types/practice'

const props = defineProps<{
  attachments: PracticeAttachment[]
  recordId: string
  load: (file: PracticeAttachment, recordId: string) => Promise<PracticeAttachmentContent>
  removable?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ remove: [id: string] }>()
const previews = reactive<Record<string, { open: boolean; loading: boolean; content?: PracticeAttachmentContent; error?: string }>>({})
watch(() => props.recordId, () => { for (const id of Object.keys(previews)) delete previews[id] })
async function preview(file: PracticeAttachment) {
  previews[file.id] ??= { open: false, loading: false }
  const state = previews[file.id]!
  state.open = !state.open
  if (!state.open || state.content || state.loading) return
  state.loading = true; state.error = ''
  try { state.content = await props.load(file, props.recordId) }
  catch (error) { state.error = (error as Error).message }
  finally { state.loading = false }
}
function imageUrl(id: string) {
  const content = previews[id]?.content
  return content?.kind === 'image' ? `data:${content.mediaType};base64,${content.data}` : ''
}
function codeText(id: string) {
  const content = previews[id]?.content
  return content?.kind === 'code' ? content.text : ''
}
</script>

<template>
  <ul class="space-y-3" aria-label="作业文件">
    <li v-for="file in attachments" :key="file.id" class="rounded-xl border border-linen bg-page-cream p-3">
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="break-all text-body-sm font-bold">{{ file.name }}</p>
          <p class="text-caption text-stone">{{ file.kind === 'image' ? '图片' : '代码 / 文本' }} · {{ Math.max(1, Math.round(file.size / 1024)) }} KB</p>
        </div>
        <UiButton size="sm" variant="text" :title="`预览 ${file.name}`" @click="preview(file)">{{ previews[file.id]?.open ? '收起' : '预览' }}</UiButton>
        <UiButton v-if="removable" size="sm" variant="text" icon :title="`移除 ${file.name}`" :disabled="disabled" @click="emit('remove', file.id)"><AppIcon name="close" :size="16" /></UiButton>
      </div>
      <div v-if="previews[file.id]?.open" class="mt-3">
        <p v-if="previews[file.id]?.loading" class="text-caption text-stone">正在读取文件…</p>
        <p v-else-if="previews[file.id]?.error" role="alert" class="text-caption text-error">{{ previews[file.id]?.error }}</p>
        <template v-else-if="previews[file.id]?.content">
          <img v-if="imageUrl(file.id)" :src="imageUrl(file.id)" :alt="file.name" class="max-h-96 max-w-full rounded-lg object-contain" />
          <pre v-else class="scroll-soft max-h-80 overflow-auto whitespace-pre-wrap break-words text-caption">{{ codeText(file.id) }}</pre>
        </template>
      </div>
    </li>
  </ul>
</template>

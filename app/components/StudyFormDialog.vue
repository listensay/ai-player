<script setup lang="ts">
import UiButton from './UiButton.vue'
import AppIcon from './AppIcon.vue'
withDefaults(
  defineProps<{
    open: boolean
    title: string
    titleId: string
    submitLabel: string
    busy?: boolean
    error?: string
    width?: number
  }>(),
  { busy: false, error: '', width: 560 },
)
const emit = defineEmits<{ 'update:open': [value: boolean]; submit: [] }>()
</script>

<template>
  <VDialog
    :model-value="open"
    :max-width="width"
    :persistent="busy"
    :aria-labelledby="titleId"
    @update:model-value="emit('update:open', $event)"
  >
    <form class="paper-dialog study-form-dialog" @submit.prevent="emit('submit')">
      <header class="flex shrink-0 items-center justify-between gap-4 border-b border-linen bg-pure-white px-6 py-5">
        <h2 :id="titleId" class="text-heading-sm">{{ title }}</h2>
        <UiButton size="sm" icon variant="text" title="关闭弹窗" :disabled="busy" @click="emit('update:open', false)"
          ><AppIcon name="close" :size="19"
        /></UiButton>
      </header>
      <div class="scroll-soft min-h-0 space-y-5 overflow-y-auto px-6 py-6">
        <slot />
        <p v-if="error" role="alert" class="text-body-sm text-error">{{ error }}</p>
      </div>
      <footer class="flex shrink-0 justify-end gap-3 border-t border-linen bg-pure-white px-6 py-4">
        <UiButton :disabled="busy" @click="emit('update:open', false)">取消</UiButton>
        <UiButton type="submit" variant="dark" :disabled="busy">{{ busy ? '处理中…' : submitLabel }}</UiButton>
      </footer>
    </form>
  </VDialog>
</template>

<style scoped>
.study-form-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 48px);
  margin: 0;
}
</style>

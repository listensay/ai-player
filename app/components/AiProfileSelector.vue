<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ selected: [id: string] }>()
const { ai } = useGuide()
const error = ref('')
const items = computed(() =>
  ai.state.collection.profiles.map((profile) => ({ title: `${profile.name} · ${profile.model}`, value: profile.id })),
)
const models = computed(
  () => ai.activeProfile.value?.modelIds ?? (ai.activeProfile.value ? [ai.activeProfile.value.model] : []),
)
async function select(id: string | null) {
  if (!id) return
  error.value = ''
  try {
    await ai.selectProfile(id)
    emit('selected', id)
  } catch (err) {
    error.value = (err as Error).message
  }
}
async function selectModel(id: string | null) {
  if (!id) return
  error.value = ''
  try {
    await ai.selectModel(id)
    emit('selected', ai.state.collection.activeId)
  } catch (err) {
    error.value = (err as Error).message
  }
}
</script>

<template>
  <div class="min-w-0">
    <VSelect
      :model-value="ai.state.collection.activeId || null"
      label="当前 AI 配置"
      aria-label="当前 AI 配置"
      :items="items"
      :placeholder="ai.state.loading ? '正在读取配置…' : items.length ? '选择 AI 配置' : '暂无 AI 配置'"
      :disabled="disabled || !ai.state.ready || ai.state.saving || !items.length"
      class="min-w-0"
      @update:model-value="select"
    />
    <VSelect
      v-if="models.length > 1"
      :model-value="ai.settings.model"
      :items="models"
      label="当前模型 ID"
      aria-label="当前模型 ID"
      :disabled="disabled || !ai.state.ready || ai.state.saving"
      class="mt-3 min-w-0"
      @update:model-value="selectModel"
    />
    <p v-if="error" role="alert" class="mt-2 text-caption text-error">{{ error }}</p>
  </div>
</template>

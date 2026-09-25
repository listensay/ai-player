<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ selected: [id: string] }>()
const { ai } = useGuide()
const error = ref('')
const items = computed(() => ai.state.collection.profiles.map(profile => ({ title: `${profile.name} · ${profile.model}`, value: profile.id })))
async function select(id: string | null) {
  if (!id) return
  error.value = ''
  try { await ai.selectProfile(id); emit('selected', id) }
  catch (err) { error.value = (err as Error).message }
}
</script>

<template>
  <div class="min-w-0">
    <VSelect :model-value="ai.state.collection.activeId || null" label="当前使用的 AI" aria-label="当前使用的 AI"
      :items="items" :placeholder="ai.state.loading ? '正在读取配置…' : items.length ? '请选择 AI' : '尚未配置 AI'"
      :disabled="disabled || !ai.state.ready || ai.state.saving || !items.length" class="min-w-0"
      @update:model-value="select" />
    <p v-if="error" role="alert" class="mt-2 text-caption text-error">{{ error }}</p>
  </div>
</template>

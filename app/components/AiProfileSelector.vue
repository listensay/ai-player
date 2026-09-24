<script setup lang="ts">
import { ref } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ selected: [id: string] }>()
const { ai } = useGuide()
const error = ref('')
async function select(event: Event) {
  const input = event.target as HTMLSelectElement
  const id = input.value
  input.value = ai.state.collection.activeId
  error.value = ''
  try { await ai.selectProfile(id); emit('selected', id) }
  catch (err) { error.value = (err as Error).message }
}
</script>

<template>
  <div class="min-w-0">
    <label class="flex min-w-0 flex-wrap items-center gap-2 text-caption font-bold text-graphite">
      当前使用的 AI
      <select :value="ai.state.collection.activeId" aria-label="当前使用的 AI"
        :disabled="disabled || !ai.state.ready || ai.state.saving || !ai.state.collection.profiles.length"
        class="min-w-0 max-w-full rounded-xl border border-linen bg-pure-white px-3 py-2 text-body-sm font-normal disabled:opacity-60" @change="select">
        <option value="" disabled>{{ ai.state.loading ? '正在读取配置…' : ai.state.collection.profiles.length ? '请选择 AI' : '尚未配置 AI' }}</option>
        <option v-for="profile in ai.state.collection.profiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ profile.model }}</option>
      </select>
    </label>
    <p v-if="error" role="alert" class="mt-2 text-caption text-error">{{ error }}</p>
  </div>
</template>

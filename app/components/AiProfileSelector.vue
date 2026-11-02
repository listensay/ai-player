<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
withDefaults(defineProps<{ disabled?: boolean; compact?: boolean }>(), { compact: false })
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
  <div
    class="ai-profile-selector min-w-0"
    :class="{ 'ai-profile-selector--compact': compact, 'ai-profile-selector--with-actions': !!$slots.actions }"
  >
    <p v-if="compact" class="mb-2 text-caption font-bold text-graphite">AI 服务</p>
    <div class="ai-profile-row">
      <VSelect
        :model-value="ai.state.collection.activeId || null"
        :label="compact ? undefined : '当前 AI 配置'"
        :single-line="compact"
        :density="compact ? 'comfortable' : undefined"
        aria-label="当前 AI 配置"
        :items="items"
        :placeholder="ai.state.loading ? '正在读取配置…' : items.length ? '选择 AI 配置' : '暂无 AI 配置'"
        :disabled="disabled || !ai.state.ready || ai.state.saving || !items.length"
        class="ai-profile-field min-w-0"
        @update:model-value="select"
      >
        <template v-if="compact" #selection="{ item }">
          <span class="ai-profile-value" :title="item.title">{{ item.title }}</span>
        </template>
      </VSelect>
      <slot name="actions" />
    </div>
    <VSelect
      v-if="models.length > 1"
      :model-value="ai.settings.model"
      :items="models"
      :label="compact ? undefined : '当前模型 ID'"
      :single-line="compact"
      :density="compact ? 'comfortable' : undefined"
      aria-label="当前模型 ID"
      :disabled="disabled || !ai.state.ready || ai.state.saving"
      class="ai-profile-field mt-3 min-w-0"
      @update:model-value="selectModel"
    />
    <p v-if="error" role="alert" class="mt-2 text-caption text-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.ai-profile-selector--with-actions .ai-profile-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
}
.ai-profile-selector--with-actions .ai-profile-field {
  flex: 0 1 320px;
  width: min(100%, 320px);
}
.ai-profile-selector--compact :deep(.v-field__input) {
  min-height: 48px;
  padding-block: 12px;
  color: var(--color-charcoal-ink);
  -webkit-mask-image: none;
  mask-image: none;
}
.ai-profile-selector--compact :deep(.v-select__selection) {
  min-width: 0;
  max-width: 100%;
  margin-block: 0;
}
.ai-profile-value {
  display: block;
  font-size: 14px;
  line-height: 24px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.ai-profile-selector--compact :deep(.v-field--disabled) {
  opacity: 1;
}
.ai-profile-selector--compact :deep(.v-field__overlay) {
  opacity: 0;
}
</style>

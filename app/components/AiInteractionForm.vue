<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { AiFormAnswers, AiFormValue, AiInteractionForm } from '~/types/aiInteraction'
import { validateAiFormAnswers } from '~/utils/aiInteraction'
import UiButton from './UiButton.vue'
import PracticeText from './PracticeText.vue'
import UiDatePicker from './UiDatePicker.vue'

const props = withDefaults(defineProps<{ form: AiInteractionForm; disabled?: boolean; answers?: AiFormAnswers }>(), {
  disabled: false,
})
const emit = defineEmits<{ submit: [answers: AiFormAnswers] }>()
const values = reactive<AiFormAnswers>({})
const error = ref('')
watch(
  () => [props.form, props.answers] as const,
  () => {
    for (const key of Object.keys(values)) delete values[key]
    for (const field of props.form.fields)
      values[field.id] = props.answers?.[field.id] ?? (field.type === 'multiple-choice' ? [] : null)
    error.value = ''
  },
  { immediate: true },
)
function update(id: string, value: AiFormValue) {
  values[id] = value
  error.value = ''
}
function toggle(id: string, choice: string, checked: boolean) {
  const selected = values[id]
  const choices = Array.isArray(selected) ? selected : []
  update(id, checked ? [...new Set([...choices, choice])] : choices.filter((value) => value !== choice))
}
function submit() {
  if (props.disabled || props.answers) return
  try {
    emit('submit', validateAiFormAnswers(props.form, values))
  } catch (reason) {
    error.value = (reason as Error).message
  }
}
</script>

<template>
  <form
    class="ai-interaction-form rounded-2xl border border-linen bg-pure-white p-4 sm:p-5"
    :aria-label="form.title || 'AI 提问'"
    @submit.prevent="submit"
  >
    <h4 v-if="form.title" class="mb-5 text-body font-bold [overflow-wrap:anywhere]">{{ form.title }}</h4>
    <div class="divide-y divide-linen">
      <div v-for="field in form.fields" :key="field.id" class="py-5 first:pt-0">
        <VRadioGroup
          v-if="field.type === 'single-choice'"
          :model-value="values[field.id]"
          :label="field.label"
          :disabled="disabled || !!answers"
          hide-details
          class="ai-form-choices"
          @update:model-value="update(field.id, $event)"
        >
          <VRadio v-for="option in field.options" :key="option.id" :value="option.id" color="ink">
            <template #label
              ><div class="py-1">
                <span class="text-body-sm">{{ option.label }}</span
                ><PracticeText
                  v-if="option.description"
                  :text="option.description"
                  class="mt-1 text-caption text-graphite"
                /></div
            ></template>
          </VRadio>
        </VRadioGroup>
        <fieldset v-else-if="field.type === 'multiple-choice'" class="min-w-0 border-0 p-0">
          <legend class="mb-3 text-body-sm font-bold">{{ field.label }}</legend>
          <VCheckbox
            v-for="option in field.options"
            :key="option.id"
            :model-value="Array.isArray(values[field.id]) && (values[field.id] as string[]).includes(option.id)"
            :disabled="disabled || !!answers"
            color="ink"
            @update:model-value="toggle(field.id, option.id, $event === true)"
          >
            <template #label
              ><div class="py-1">
                <span class="text-body-sm">{{ option.label }}</span
                ><PracticeText
                  v-if="option.description"
                  :text="option.description"
                  class="mt-1 text-caption text-graphite"
                /></div
            ></template>
          </VCheckbox>
        </fieldset>
        <VTextarea
          v-else-if="field.type === 'textarea'"
          :model-value="values[field.id]"
          :label="field.label"
          :placeholder="field.placeholder"
          :maxlength="field.maxLength"
          :disabled="disabled || !!answers"
          rows="3"
          auto-grow
          @update:model-value="update(field.id, $event)"
        />
        <UiDatePicker
          v-else-if="field.type === 'date'"
          :model-value="typeof values[field.id] === 'string' ? (values[field.id] as string) : ''"
          :label="field.label"
          :min="field.min"
          :max="field.max"
          :disabled="disabled || !!answers"
          clearable
          @update:model-value="update(field.id, $event)"
        />
        <VTextField
          v-else
          :model-value="values[field.id]"
          :label="field.label"
          :type="field.type === 'text' ? 'text' : field.type"
          :step="field.type === 'number' ? 'any' : undefined"
          :placeholder="'placeholder' in field ? field.placeholder : undefined"
          :maxlength="'maxLength' in field ? field.maxLength : undefined"
          :min="'min' in field ? field.min : undefined"
          :max="'max' in field ? field.max : undefined"
          :disabled="disabled || !!answers"
          @update:model-value="update(field.id, $event)"
        />
      </div>
    </div>
    <p v-if="error" class="mb-3 text-body-sm text-error" role="alert">{{ error }}</p>
    <UiButton v-if="!answers" type="submit" variant="dark" class="w-full" :disabled="disabled">{{
      form.submitLabel
    }}</UiButton>
    <p v-else class="text-caption text-stone" role="status">已提交</p>
  </form>
</template>

<style scoped>
.ai-form-choices :deep(.v-input__control > .v-label) {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  opacity: 1;
  color: var(--color-charcoal-ink);
}
.ai-form-choices :deep(.v-selection-control) {
  align-items: flex-start;
}
.ai-interaction-form :deep(.v-label) {
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>

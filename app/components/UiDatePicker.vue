<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CalendarDays } from '@lucide/vue'
import { useDate } from 'vuetify'
import { VDatePicker } from 'vuetify/components/VDatePicker'
import { validDate } from '~/utils/studyProgram'
import UiButton from './UiButton.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ label: string; min?: string; required?: boolean }>()
const model = defineModel<string>({ required: true })
const date = useDate()
const open = ref(false)
const draft = ref<Date | null>(null)
// 日期是本地日历日，使用适配器转换，避免 UTC 序列化导致日期偏移。
const selectedDate = computed(() => (draft.value && date.isValid(draft.value) ? date.toISO(draft.value) : ''))
const canConfirm = computed(() => validDate(selectedDate.value) && (!props.min || selectedDate.value >= props.min))
watch([open, model], ([isOpen]) => {
  if (isOpen) draft.value = validDate(model.value) ? date.toJsDate(date.date(model.value)) : null
})
function confirm() {
  if (!canConfirm.value) return
  model.value = selectedDate.value
  open.value = false
}
</script>

<template>
  <VMenu
    v-model="open"
    :width="330"
    :min-width="0"
    :max-width="330"
    location="bottom start"
    :close-on-content-click="false"
    :content-props="{ role: 'dialog', 'aria-label': `选择${label}` }"
  >
    <template #activator="{ props: activatorProps }">
      <VTextField
        v-bind="{ ...$attrs, ...activatorProps }"
        :model-value="model"
        :label="label"
        :required="required"
        :append-inner-icon="CalendarDays"
        readonly
        aria-haspopup="dialog"
        :aria-label="`选择${label}`"
        @keydown.enter.prevent="open = !open"
        @keydown.space.prevent="open = !open"
        @keydown.down.prevent="open = true"
      />
    </template>
    <VCard class="w-full">
      <VDatePicker
        v-if="open"
        v-model="draft"
        :min="min"
        :aria-label="`选择${label}`"
        width="100%"
        hide-header
        weeks-in-month="dynamic"
        color="secondary"
      />
      <div class="flex justify-end gap-2 border-t border-linen p-3">
        <UiButton size="sm" variant="text" @click="open = false">取消</UiButton>
        <UiButton size="sm" variant="dark" :disabled="!canConfirm" @click="confirm">确定</UiButton>
      </div>
    </VCard>
  </VMenu>
</template>

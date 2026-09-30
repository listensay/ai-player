<script setup lang="ts">
import { ref, watch } from 'vue'
import { VTimePicker } from 'vuetify/components/VTimePicker'
import UiButton from './UiButton.vue'
const model = defineModel<string>({ required: true })
const open = ref(false)
const draft = ref(model.value)
watch(open, (value) => {
  if (value) draft.value = model.value
})
function confirm() {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.value)) return
  model.value = draft.value
  open.value = false
}
</script>

<template>
  <VMenu v-model="open" :close-on-content-click="false">
    <template #activator="{ props }">
      <VTextField
        v-bind="props"
        :model-value="model"
        label="提醒时间"
        readonly
        aria-label="选择提醒时间"
        @keydown.enter.prevent="open = !open"
        @keydown.space.prevent="open = !open"
      />
    </template>
    <VCard aria-label="提醒时间选择器">
      <VTimePicker v-model="draft" format="24hr" title="选择提醒时间" />
      <div class="flex justify-end gap-2 p-3">
        <UiButton size="sm" variant="text" @click="open = false">取消</UiButton>
        <UiButton size="sm" variant="dark" @click="confirm">确定</UiButton>
      </div>
    </VCard>
  </VMenu>
</template>

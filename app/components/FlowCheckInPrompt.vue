<script setup lang="ts">
import { useLearningManagement } from '~/composables/useLearningManagement'
import { FLOW_LABELS } from '~/utils/learningManagement'
import UiButton from './UiButton.vue'
const learning = useLearningManagement()
</script>
<template>
  <VDialog
    :model-value="!!learning.pendingFlow.value"
    max-width="560"
    aria-labelledby="flow-check-title"
    @update:model-value="!$event && (learning.pendingFlow.value = null)"
  >
    <section class="pane p-6">
      <h2 id="flow-check-title" class="text-heading-sm">刚才学得怎么样？</h2>
      <div class="mt-6 grid grid-cols-2 gap-3">
        <UiButton
          v-for="(label, mood) in FLOW_LABELS"
          :key="mood"
          :disabled="!!learning.state.saving"
          @click="learning.checkFlow(mood)"
          >{{ label }}</UiButton
        >
      </div>
      <p v-if="learning.state.error" role="alert" class="mt-3 text-body-sm text-error">{{ learning.state.error }}</p>
      <UiButton variant="text" class="mt-4" @click="learning.pendingFlow.value = null">这次跳过</UiButton>
    </section>
  </VDialog>
</template>

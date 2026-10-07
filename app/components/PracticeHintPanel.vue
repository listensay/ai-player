<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PracticeRecord } from '~/types/practice'
import {
  nextPracticeHintLevel,
  practiceHelpLevel,
  practiceHelpLabel,
  PRACTICE_HELP_LABELS,
} from '~/utils/practiceHints'
import { programmingQuestion } from '~/utils/programming'
import PracticeText from '~/components/PracticeText.vue'
import UiButton from '~/components/UiButton.vue'

const props = defineProps<{
  record: PracticeRecord
  busy: boolean
  loading: boolean
  configured: boolean
  error: string
}>()
const emit = defineEmits<{ hint: []; reference: []; settings: [] }>()
const panel = ref<number>()
const level = computed(() => practiceHelpLevel(props.record))
const nextLevel = computed(() => nextPracticeHintLevel(props.record))
const referenceCode = computed(() => programmingQuestion(props.record.question)?.referenceCode)
watch(
  () => [props.record.id, props.record.help?.hints.length, props.record.help?.level],
  () => {
    panel.value = props.record.help?.level === 4 ? 4 : props.record.help?.hints.at(-1)?.level
  },
  { immediate: true },
)
function showReference() {
  emit('reference')
  if (props.record.help?.level === 4) panel.value = 4
}
</script>

<template>
  <section aria-label="分层提示" class="space-y-4 rounded-xl border border-linen bg-pure-white p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h4 class="text-body font-bold">分层提示</h4>
      <span class="text-caption text-stone">{{ practiceHelpLabel(level) }}</span>
    </div>
    <VExpansionPanels v-if="record.help?.hints.length || record.help?.level === 4" v-model="panel">
      <VExpansionPanel v-for="hint in record.help?.hints ?? []" :key="hint.level" :value="hint.level">
        <VExpansionPanelTitle>{{ hint.level }}. {{ PRACTICE_HELP_LABELS[hint.level] }}</VExpansionPanelTitle>
        <VExpansionPanelText><PracticeText :text="hint.text" /></VExpansionPanelText>
      </VExpansionPanel>
      <VExpansionPanel v-if="record.help?.level === 4" :value="4">
        <VExpansionPanelTitle>4. 参考答案</VExpansionPanelTitle>
        <VExpansionPanelText>
          <pre v-if="referenceCode" class="mb-4 whitespace-pre-wrap break-words font-mono text-body-sm">{{
            referenceCode
          }}</pre>
          <PracticeText :text="record.question.referenceAnswer" />
        </VExpansionPanelText>
      </VExpansionPanel>
    </VExpansionPanels>
    <p v-if="error" role="alert" class="text-body-sm text-error">{{ error }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <template v-if="nextLevel && level < 4">
        <UiButton v-if="configured" size="sm" :disabled="busy" @click="emit('hint')">
          {{ loading ? '正在生成提示…' : `${error ? '重试：' : '查看'}${PRACTICE_HELP_LABELS[nextLevel]}` }}
        </UiButton>
        <UiButton v-else size="sm" variant="ghost" :disabled="busy" @click="emit('settings')">配置 AI</UiButton>
      </template>
      <UiButton v-if="record.help?.level !== 4" size="sm" variant="text" :disabled="busy" @click="showReference"
        >查看参考答案</UiButton
      >
    </div>
  </section>
</template>

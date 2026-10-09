<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useLearningManagement } from '~/composables/useLearningManagement'
import { learningCalendar } from '~/utils/learningOutcomes'
import { desktopInvoke } from '~/utils/platform'
import ReminderTimePicker from './ReminderTimePicker.vue'
import UiButton from './UiButton.vue'
const learning = useLearningManagement()
const preferences = reactive({ ...learning.state.data.preferences }),
  error = ref(''),
  busy = ref(false),
  notice = ref('')
watch(
  () => learning.state.ready,
  (ready) => {
    if (ready) Object.assign(preferences, learning.state.data.preferences)
  },
  { immediate: true },
)
async function save() {
  if (
    await learning.mutate((data) => {
      data.preferences = { ...preferences, calendarDays: Number(preferences.calendarDays) }
    })
  ) {
    notice.value = '学习偏好已保存'
    if (preferences.calendarEnabled) await learning.publishCalendar()
  }
}
async function exportCalendar() {
  busy.value = true
  error.value = ''
  try {
    await learning.refresh()
    const content = learningCalendar(
      learning.courses.value,
      learning.date.value,
      preferences.calendarTime,
      Number(preferences.calendarDays),
    )
    await desktopInvoke('export_study_digest', {
      name: 'Karen-学习日程.ics',
      format: 'ics',
      bytes: Array.from(new TextEncoder().encode(content)),
    })
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
async function subscribe() {
  busy.value = true
  error.value = ''
  try {
    preferences.calendarEnabled = true
    await save()
    if (!learning.calendarUrl.value) throw Error(learning.calendarError.value || '日历订阅未就绪。')
    await desktopInvoke('subscribe_learning_calendar')
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
async function copyLink() {
  try {
    await navigator.clipboard.writeText(learning.calendarUrl.value)
    notice.value = '订阅链接已复制'
  } catch {
    error.value = '复制失败，请手动选择链接。'
  }
}
</script>
<template>
  <section class="space-y-6" aria-label="学习日历">
    <p
      v-if="error || learning.state.error || learning.calendarError.value"
      role="alert"
      class="text-body-sm text-error"
    >
      {{ error || learning.state.error || learning.calendarError.value }}
    </p>
    <p v-if="notice" role="status" class="text-body-sm text-deep-indigo">{{ notice }}</p>
    <article class="pane space-y-5 p-6">
      <h2 class="text-heading-sm">学习日历</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <ReminderTimePicker v-model="preferences.calendarTime" label="学习开始时间" /><VTextField
          v-model.number="preferences.calendarDays"
          label="未来天数"
          type="number"
          min="1"
          max="90"
        />
      </div>
      <VCheckbox v-model="preferences.calendarEnabled" label="自动更新日历订阅" />
      <div class="flex flex-wrap gap-3">
        <UiButton variant="dark" :disabled="busy || !learning.state.ready" @click="subscribe"
          >订阅到 Apple 日历</UiButton
        ><UiButton :disabled="busy" @click="exportCalendar">导出日历文件</UiButton>
      </div>
      <p class="text-caption text-stone">Apple 日历使用本机订阅，Google 日历可导入日历文件。</p>
      <template v-if="learning.calendarUrl.value"
        ><VTextField :model-value="learning.calendarUrl.value" label="本机订阅链接" readonly /><UiButton
          size="sm"
          @click="copyLink"
          >复制链接</UiButton
        ></template
      >
    </article>
    <article class="pane space-y-4 p-6">
      <h2 class="text-heading-sm">专注伴学</h2>
      <VCheckbox v-model="preferences.flowPrompt" label="专注结束后，记录心流状态" /><VCheckbox
        v-model="preferences.quietFocus"
        label="全屏专注时，让 Karen 安静陪读"
      /><VTextField
        v-model="preferences.shortcut"
        label="macOS 专注快捷指令"
        placeholder="例如：开始学习"
        maxlength="200"
      />
      <p class="text-caption text-stone">开始番茄钟时运行所选快捷指令。</p>
      <UiButton variant="dark" :disabled="!!learning.state.saving || !learning.state.ready" @click="save"
        >保存学习偏好</UiButton
      >
    </article>
  </section>
</template>

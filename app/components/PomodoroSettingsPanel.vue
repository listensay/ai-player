<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { usePomodoro } from '~/composables/usePomodoro'
import { formatPomodoro, POMODORO_LABELS } from '~/utils/pomodoro'
import UiButton from './UiButton.vue'
const clock = usePomodoro()
const draft = reactive({ ...clock.state.settings })
const saved = ref('')
watch(
  () => clock.state.settings,
  (value) => Object.assign(draft, value),
  { immediate: true },
)
const current = clock.snapshot
const label = computed(() => POMODORO_LABELS[current.value.phase])
async function save() {
  saved.value = ''
  if (await clock.saveSettings({ ...draft })) saved.value = '番茄钟设置已保存。'
}
</script>
<template>
  <section id="settings-pomodoro" aria-labelledby="pomodoro-heading">
    <h2 id="pomodoro-heading" class="text-heading-sm">番茄钟</h2>
    <div class="pane mt-5 space-y-4 p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="text-body font-bold">
          {{ label }} ·
          {{ current.status === 'running' ? '进行中' : current.status === 'paused' ? '已暂停' : '待开始' }}
        </h3>
        <span class="text-caption text-stone">第 {{ current.round }} / {{ current.longBreakEvery }} 轮</span>
      </div>
      <p class="tabular text-display font-bold" aria-label="番茄钟剩余时间">
        {{ formatPomodoro(current.remainingSeconds) }}
      </p>
      <p class="text-caption text-stone">已完成 {{ current.completedFocuses }} 次专注</p>
      <div class="flex flex-wrap gap-2">
        <UiButton
          v-if="current.status === 'running'"
          :disabled="!current.ready || !current.enabled"
          @click="clock.pause()"
          >暂停番茄钟</UiButton
        >
        <UiButton v-else :disabled="!current.ready || !current.enabled" @click="clock.start()">{{
          current.status === 'paused' ? `继续${label}` : `开始${label}`
        }}</UiButton>
        <UiButton variant="ghost" :disabled="!current.ready || !current.enabled" @click="clock.reset()"
          >重新开始一轮</UiButton
        >
      </div>
      <p v-if="current.notice" role="status" class="text-body-sm font-medium text-deep-indigo">{{ current.notice }}</p>
    </div>
    <div class="pane mt-5 space-y-5 p-5">
      <VSwitch
        v-model="draft.enabled"
        color="secondary"
        label="启用番茄钟"
        :disabled="!clock.state.ready || clock.state.saving"
        hide-details
      />
      <VSwitch
        v-model="draft.showOnCompanion"
        color="secondary"
        label="桌宠显示番茄钟阶段提醒"
        :disabled="!clock.state.ready || clock.state.saving"
        hide-details
      />
      <div class="grid gap-4 sm:grid-cols-2">
        <VTextField
          :model-value="draft.focusMinutes"
          type="number"
          label="专注时长（分钟）"
          min="1"
          max="180"
          :disabled="!clock.state.ready || clock.state.saving"
          @update:model-value="draft.focusMinutes = Number($event)"
        />
        <VTextField
          :model-value="draft.shortBreakMinutes"
          type="number"
          label="短休息（分钟）"
          min="1"
          max="60"
          :disabled="!clock.state.ready || clock.state.saving"
          @update:model-value="draft.shortBreakMinutes = Number($event)"
        />
        <VTextField
          :model-value="draft.longBreakMinutes"
          type="number"
          label="长休息（分钟）"
          min="1"
          max="120"
          :disabled="!clock.state.ready || clock.state.saving"
          @update:model-value="draft.longBreakMinutes = Number($event)"
        />
        <VTextField
          :model-value="draft.longBreakEvery"
          type="number"
          label="长休息间隔（专注次数）"
          min="2"
          max="12"
          :disabled="!clock.state.ready || clock.state.saving"
          @update:model-value="draft.longBreakEvery = Number($event)"
        />
      </div>
      <UiButton :disabled="!clock.state.ready || clock.state.saving" @click="save">{{
        clock.state.saving ? '正在保存…' : '保存番茄钟设置'
      }}</UiButton>
      <p v-if="saved && !clock.state.error" role="status" class="text-body-sm">{{ saved }}</p>
      <p v-if="clock.state.error" role="alert" class="text-body-sm text-error">
        {{ clock.state.error }}
        <UiButton size="sm" variant="text" @click="clock.state.ready ? clock.persist() : clock.load()">重试</UiButton>
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useDesktopSettings } from '~/composables/useDesktopSettings'
import { useStudyTools } from '~/composables/useStudyTools'
import UiButton from './UiButton.vue'

const desktop = useDesktopSettings()
const tools = useStudyTools()
function setReminderSound(enabled: boolean) {
  void tools.mutate((data) => {
    data.reminderSound = enabled
  })
}
</script>

<template>
  <section id="settings-general" aria-labelledby="general-heading">
    <h2 id="general-heading" class="text-heading-sm">通用设置</h2>
    <div class="pane mt-5 divide-y divide-linen px-5">
      <VSwitch
        :model-value="desktop.state.autostart"
        label="开机自启"
        color="secondary"
        :disabled="!desktop.state.ready || desktop.state.busy"
        :loading="desktop.state.busy"
        hide-details
        inset
        class="py-3"
        @update:model-value="desktop.setAutostart($event === true)"
      />
      <div class="flex items-center justify-between gap-3 py-3">
        <VSwitch
          :model-value="tools.state.data.reminderSound"
          label="提醒响铃"
          color="secondary"
          :disabled="!tools.state.ready || !!tools.state.saving || tools.mac.busy"
          hide-details
          inset
          @update:model-value="setReminderSound($event === true)"
        />
        <UiButton size="sm" :disabled="desktop.state.previewing" @click="desktop.previewSound()">试听</UiButton>
      </div>
      <p class="py-4 text-body-sm text-stone">关闭窗口后可从系统托盘打开，或在托盘菜单中退出。</p>
    </div>
    <div v-if="desktop.state.error || tools.state.error" class="mt-4 flex flex-wrap items-center gap-3">
      <p role="alert" class="text-body-sm text-error">{{ desktop.state.error || tools.state.error }}</p>
      <UiButton v-if="!desktop.state.ready" size="sm" :disabled="desktop.state.busy" @click="desktop.load()"
        >重试</UiButton
      >
      <UiButton v-if="!tools.state.ready" size="sm" @click="tools.load()">重试</UiButton>
    </div>
  </section>
</template>

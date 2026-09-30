<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useStudyTools } from '~/composables/useStudyTools'
import type { StudyReminder } from '~/types/studyTools'
import UiButton from './UiButton.vue'
import AppIcon from './AppIcon.vue'
const tools = useStudyTools(),
  router = useRouter()
async function start(reminder: StudyReminder) {
  if (await tools.dismiss(reminder.id))
    await router.push(reminder.courseId ? `/courses/${encodeURIComponent(reminder.courseId)}` : '/')
}
</script>

<template>
  <aside
    v-if="tools.pending.value.length"
    aria-label="学习提醒"
    class="max-h-48 shrink-0 overflow-y-auto border-b border-linen bg-sunbeam-yellow/20 px-5 py-3"
  >
    <div
      v-for="reminder in tools.pending.value"
      :key="reminder.id"
      class="flex flex-wrap items-center gap-3 py-1"
      role="status"
    >
      <AppIcon name="bell" :size="18" />
      <p class="min-w-0 flex-1 break-words text-body-sm font-bold">{{ reminder.title }}</p>
      <UiButton size="sm" variant="dark" :disabled="!!tools.state.saving" @click="start(reminder)">开始学习</UiButton>
      <UiButton size="sm" variant="text" :disabled="!!tools.state.saving" @click="tools.snooze(reminder.id)"
        >10 分钟后提醒</UiButton
      >
      <UiButton
        size="sm"
        icon
        variant="text"
        title="关闭提醒"
        :disabled="!!tools.state.saving"
        @click="tools.dismiss(reminder.id)"
        ><AppIcon name="close" :size="16"
      /></UiButton>
    </div>
    <p v-if="tools.state.error" role="alert" class="text-caption text-error">{{ tools.state.error }}</p>
  </aside>
</template>

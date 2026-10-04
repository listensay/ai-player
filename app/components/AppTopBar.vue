<script setup lang="ts">
import type { PomodoroSnapshot } from '~/types/pomodoro'
import PomodoroBadge from '~/components/PomodoroBadge.vue'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
import { RouterLink } from 'vue-router'
/** 应用导航、课程进度与学习工具。 */
defineProps<{
  companionActive?: boolean
  companionBusy?: boolean
  pomodoro?: PomodoroSnapshot
  courseName?: string
  total?: number
  done?: number
  /** 当前视图：仪表盘或播放器 */
  currentView?: 'dashboard' | 'player'
}>()

const emit = defineEmits<{
  pomodoroStart: []
  pomodoroPause: []
  pomodoroReset: []
  pomodoroSettings: []
  companion: []
  help: []
  close: []
  back: []
  settings: []
  study: []
  milestones: []
  guide: []
}>()
</script>

<template>
  <header
    class="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-linen bg-pure-white px-3 sm:px-4 md:px-5"
  >
    <div class="flex min-w-0 items-center gap-3 overflow-hidden">
      <RouterLink to="/" aria-label="AI Player 首页" class="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
        <span class="h-3.5 w-3.5 rounded-full bg-brand-orange" aria-hidden="true" />
        <span class="text-body font-bold tracking-[-0.03em] text-charcoal-ink">AI Player</span>
      </RouterLink>
      <div v-if="courseName" class="hidden min-w-0 items-center gap-3 border-l border-linen pl-4 lg:flex">
        <span class="truncate text-body-sm font-medium text-charcoal-ink" :title="courseName">{{ courseName }}</span>
        <span v-if="total" class="tabular hidden shrink-0 text-caption text-stone 2xl:inline">
          共 {{ total }} 节 · 已完成 {{ done }} 节
        </span>
      </div>
    </div>

    <!-- Equal outer columns keep the timer centered on the window, regardless of toolbar width. -->
    <div class="flex justify-center">
      <PomodoroBadge
        v-if="currentView === 'player' && pomodoro"
        :timer="pomodoro"
        @start="emit('pomodoroStart')"
        @pause="emit('pomodoroPause')"
        @reset="emit('pomodoroReset')"
        @settings="emit('pomodoroSettings')"
      />
    </div>

    <div aria-label="顶部操作" class="flex min-w-0 items-center justify-end gap-2">
      <UiButton
        v-if="currentView === 'player'"
        variant="ghost"
        size="sm"
        title="返回视频信息"
        aria-label="返回视频信息"
        @click="emit('back')"
        >返回</UiButton
      >
      <template v-else-if="courseName">
        <UiButton variant="ghost" size="sm" title="AI 导学" aria-label="AI 导学" @click="emit('guide')">
          <AppIcon name="sparkles" :size="17" class="text-deep-indigo" />
          <span>AI 导学</span>
        </UiButton>
        <UiButton variant="ghost" size="sm" title="返回首页" aria-label="返回首页" @click="emit('close')">
          返回首页
        </UiButton>
      </template>
      <template v-else>
        <UiButton
          variant="text"
          size="sm"
          @click="emit('study')"
          class="flex items-center gap-1.5 rounded-full px-3 py-2 text-caption font-bold hover:bg-page-cream"
          aria-label="学习管理"
          title="学习管理"
        >
          <AppIcon name="bell" :size="18" /><span class="hidden 2xl:inline">学习管理</span>
        </UiButton>
        <UiButton
          variant="text"
          size="sm"
          @click="emit('milestones')"
          class="flex items-center gap-1.5 rounded-full px-3 py-2 text-caption font-bold hover:bg-page-cream"
          aria-label="里程碑勋章"
          title="里程碑勋章"
        >
          <AppIcon name="trophy" :size="18" /><span class="hidden 2xl:inline">勋章</span>
        </UiButton>
        <UiButton
          variant="text"
          size="sm"
          @click="emit('settings')"
          class="flex items-center gap-1.5 rounded-full px-3 py-2 text-caption font-bold hover:bg-page-cream"
          aria-label="设置"
          title="设置"
        >
          <AppIcon name="settings" :size="18" /><span class="hidden 2xl:inline">设置</span>
        </UiButton>
        <UiButton
          variant="text"
          size="sm"
          :title="companionActive ? '关闭桌面挂件' : '打开桌面挂件'"
          :aria-pressed="!!companionActive"
          :disabled="companionBusy"
          aria-label="桌面挂件"
          class="companion-toggle max-sm:h-8 max-sm:w-8 max-sm:p-0"
          @click="emit('companion')"
        >
          <AppIcon name="pip" :size="18" /><span class="hidden 2xl:inline">桌面挂件</span>
        </UiButton>
        <UiButton
          variant="text"
          size="sm"
          title="快捷键（?）"
          aria-label="快捷键"
          class="max-sm:h-8 max-sm:w-8 max-sm:p-0"
          @click="emit('help')"
        >
          <AppIcon name="keyboard" :size="18" /><span class="hidden 2xl:inline">快捷键</span>
        </UiButton>
      </template>
    </div>
  </header>
</template>

<style scoped>
.companion-toggle.ui-button.v-btn[aria-pressed='true'] {
  background: var(--color-page-cream);
  color: var(--color-deep-indigo);
  border-color: var(--color-deep-indigo);
}
</style>

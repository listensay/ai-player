<script setup lang="ts">
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
import { RouterLink } from 'vue-router'
/** 应用导航、课程进度与学习工具。 */
defineProps<{
  courseName?: string
  total?: number
  done?: number
  /** 当前视图：仪表盘或播放器 */
  currentView?: 'dashboard' | 'player'
}>()

const emit = defineEmits<{
  help: []
  close: []
  back: []
  settings: []
  study: []
  guide: []
  notes: []
  versions: []
}>()
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-linen bg-pure-white px-3 sm:px-4 md:px-5"
    :class="{ 'player-header': currentView === 'player' && $slots.center }"
  >
    <div class="flex min-w-0 items-center gap-3 overflow-hidden">
      <RouterLink to="/" aria-label="Study Helper 首页" class="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
        <span class="h-3.5 w-3.5 rounded-full bg-brand-orange" aria-hidden="true" />
        <span class="text-body font-bold tracking-[-0.03em] text-charcoal-ink">Study Helper</span>
      </RouterLink>
    </div>

    <div v-if="$slots.center" class="min-w-0">
      <slot name="center" />
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
        <UiButton variant="text" size="sm" aria-label="笔记" title="笔记" @click="emit('notes')">
          <AppIcon name="note" :size="18" /><span>笔记</span>
        </UiButton>
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
          @click="emit('settings')"
          class="flex items-center gap-1.5 rounded-full px-3 py-2 text-caption font-bold hover:bg-page-cream"
          aria-label="设置"
          title="设置"
        >
          <AppIcon name="settings" :size="18" /><span class="hidden 2xl:inline">设置</span>
        </UiButton>
        <UiButton variant="text" size="sm" title="版本日志" aria-label="版本日志" @click="emit('versions')">
          <AppIcon name="clock" :size="18" /><span class="hidden 2xl:inline">版本日志</span>
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
.player-header {
  display: grid;
  grid-template-columns: minmax(128px, 1fr) auto minmax(128px, 1fr);
}

@media (max-width: 760px) {
  .player-header {
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
  }
}
</style>

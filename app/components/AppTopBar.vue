<script setup lang="ts">

import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
import { RouterLink } from 'vue-router'
/** 应用导航、课程进度与学习工具。 */
defineProps<{
  courseName?: string
  courseId?: string
  videoPath?: string
  total?: number
  done?: number
  /** 当前视图：仪表盘或播放器 */
  currentView?: 'dashboard' | 'player'
  /** 小屏下显示"目录"开关 */
  showTreeToggle?: boolean
}>()

const emit = defineEmits<{
  help: []
  close: []
  toggleTree: []
  guide: []
}>()
</script>

<template>
  <header class="flex h-14 shrink-0 items-center gap-2 border-b border-linen bg-pure-white px-3 sm:gap-4 sm:px-4 md:px-5">
    <RouterLink to="/" aria-label="AI Player 首页" class="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
      <span class="h-3.5 w-3.5 rounded-full bg-brand-orange" aria-hidden="true" />
      <span class="text-body font-bold tracking-[-0.03em] text-charcoal-ink">AI Player</span>
    </RouterLink>

    <!-- 课程名称与集数进度 -->
    <div v-if="courseName" class="hidden min-w-0 items-center gap-3 border-l border-linen pl-4 md:flex">
      <span class="truncate text-body-sm font-medium text-charcoal-ink" :title="courseName">{{ courseName }}</span>
      <span v-if="total" class="tabular hidden shrink-0 text-caption text-stone lg:inline">
        共 {{ total }} 节 · 已完成 {{ done }} 节
      </span>
    </div>

    <!-- 仪表盘 / 播放器 切换器 -->
    <div v-if="courseName" class="flex shrink-0 items-center">
      <div class="flex items-center rounded-xl border border-linen bg-page-cream p-0.5 text-caption font-medium">
        <RouterLink
          class="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 transition-all"
          :class="currentView === 'dashboard' ? 'bg-pure-white text-charcoal-ink font-bold shadow-xs' : 'text-stone hover:text-charcoal-ink'"
          title="查看课程概览"
          aria-label="概览"
          :to="`/courses/${courseId}`"
          :aria-current="currentView === 'dashboard' ? 'page' : undefined"
        >
          <AppIcon name="dashboard" :size="14" />
          <span class="hidden sm:inline">概览</span>
        </RouterLink>
        <RouterLink
          class="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 transition-all"
          :class="currentView === 'player' ? 'bg-pure-white text-charcoal-ink font-bold shadow-xs' : 'text-stone hover:text-charcoal-ink'"
          title="切换至视频播放与笔记"
          aria-label="播放器"
          :to="{ path: `/courses/${courseId}/player`, query: { lesson: videoPath } }"
          :aria-current="currentView === 'player' ? 'page' : undefined"
        >
          <AppIcon name="play" :size="14" />
          <span class="hidden sm:inline">播放器</span>
        </RouterLink>
      </div>
    </div>

    <div class="flex-1" />

    <!-- 右侧工具栏 -->
    <div class="flex shrink-0 items-center gap-1.5">
      <UiButton v-if="courseName" variant="ghost" size="sm" title="AI 智能导学与定制路线" class="max-sm:h-8 max-sm:w-8 max-sm:p-0" @click="emit('guide')">
        <AppIcon name="sparkles" :size="17" class="text-deep-indigo" />
        <span class="hidden sm:inline">AI 导学</span>
      </UiButton>
      <UiButton v-if="showTreeToggle && currentView === 'player'" variant="text" size="sm" title="目录" class="max-sm:h-8 max-sm:w-8 max-sm:p-0 lg:hidden" @click="emit('toggleTree')">
        <AppIcon name="menu" :size="18" />
        <span class="hidden sm:inline">目录</span>
      </UiButton>
      <UiButton variant="text" size="sm" title="快捷键（?）" class="max-sm:h-8 max-sm:w-8 max-sm:p-0" @click="emit('help')">
        <AppIcon name="keyboard" :size="18" />
        <span class="hidden sm:inline">快捷键</span>
      </UiButton>
      <UiButton v-if="courseName" variant="ghost" size="sm" title="返回首页" @click="emit('close')"><span class="hidden sm:inline">返回首页</span><span class="sm:hidden">首页</span></UiButton>
    </div>
  </header>
</template>

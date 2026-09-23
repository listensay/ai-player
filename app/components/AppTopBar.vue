<script setup lang="ts">
/** 顶栏：橙色 logo 点 + 字标（永远在左上角），课程名与进度，视图切换与右侧工具按钮 */
defineProps<{
  courseName?: string
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
  switchView: [view: 'dashboard' | 'player']
}>()
</script>

<template>
  <header class="flex h-14 shrink-0 items-center gap-2 border-b border-linen bg-pure-white px-3 sm:gap-4 sm:px-4 md:px-5">
    <div class="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
      <span class="h-3.5 w-3.5 rounded-full bg-brand-orange" aria-hidden="true" />
      <span class="text-body font-bold tracking-[-0.03em] text-charcoal-ink">AI Player</span>
    </div>

    <!-- 课程名称与集数进度 -->
    <div v-if="courseName" class="hidden min-w-0 items-center gap-3 border-l border-linen pl-4 md:flex">
      <span class="truncate text-body-sm font-medium text-charcoal-ink" :title="courseName">{{ courseName }}</span>
      <span v-if="total" class="tabular hidden shrink-0 text-caption text-stone lg:inline">
        {{ total }} 集，已看完 {{ done }} 集
      </span>
    </div>

    <!-- 仪表盘 / 播放器 切换器 -->
    <div v-if="courseName" class="flex items-center">
      <div class="flex items-center rounded-xl border border-linen bg-page-cream p-0.5 text-caption font-medium">
        <button
          type="button"
          class="flex items-center gap-1 rounded-lg px-2.5 py-1 transition-all"
          :class="currentView === 'dashboard' ? 'bg-pure-white text-charcoal-ink font-bold shadow-xs' : 'text-stone hover:text-charcoal-ink'"
          title="切换至项目仪表盘"
          @click="emit('switchView', 'dashboard')"
        >
          <AppIcon name="dashboard" :size="14" />
          <span>仪表盘</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-1 rounded-lg px-2.5 py-1 transition-all"
          :class="currentView === 'player' ? 'bg-pure-white text-charcoal-ink font-bold shadow-xs' : 'text-stone hover:text-charcoal-ink'"
          title="切换至视频播放与笔记"
          @click="emit('switchView', 'player')"
        >
          <AppIcon name="play" :size="14" />
          <span>播放器</span>
        </button>
      </div>
    </div>

    <div class="flex-1" />

    <!-- 右侧工具栏 -->
    <div class="flex items-center gap-1.5">
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
      <UiButton v-if="courseName" variant="ghost" size="sm" @click="emit('close')">切换课程</UiButton>
    </div>
  </header>
</template>

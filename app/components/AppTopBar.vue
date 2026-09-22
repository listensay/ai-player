<script setup lang="ts">
/** 顶栏：橙色 logo 点 + 字标（永远在左上角），课程名与进度，右侧是工具按钮 */
defineProps<{
  courseName?: string
  total?: number
  done?: number
  /** 小屏下显示"目录"开关 */
  showTreeToggle?: boolean
}>()

const emit = defineEmits<{
  help: []
  close: []
  toggleTree: []
}>()
</script>

<template>
  <header class="flex h-14 shrink-0 items-center gap-4 border-b border-linen bg-pure-white px-4 md:px-5">
    <div class="flex items-center gap-2.5">
      <span class="h-3.5 w-3.5 rounded-full bg-brand-orange" aria-hidden="true" />
      <span class="text-body font-bold tracking-[-0.03em] text-charcoal-ink">AI Player</span>
    </div>

    <div v-if="courseName" class="flex min-w-0 flex-1 items-center gap-3 border-l border-linen pl-4">
      <span class="truncate text-body-sm font-medium text-charcoal-ink" :title="courseName">{{ courseName }}</span>
      <span v-if="total" class="tabular hidden shrink-0 text-caption text-stone sm:inline">
        {{ total }} 集，已看完 {{ done }} 集
      </span>
    </div>
    <div v-else class="flex-1" />

    <div class="flex items-center gap-1.5">
      <UiButton v-if="showTreeToggle" variant="text" size="sm" title="目录" class="lg:hidden" @click="emit('toggleTree')">
        <AppIcon name="menu" :size="18" />
        目录
      </UiButton>
      <UiButton variant="text" size="sm" title="快捷键（?）" @click="emit('help')">
        <AppIcon name="keyboard" :size="18" />
        <span class="hidden sm:inline">快捷键</span>
      </UiButton>
      <UiButton v-if="courseName" variant="ghost" size="sm" @click="emit('close')">切换课程</UiButton>
    </div>
  </header>
</template>

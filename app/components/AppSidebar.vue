<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '~/components/AppIcon.vue'
import type { Course } from '~/types/course'

defineProps<{
  course?: Course | null
  currentView?: 'dashboard' | 'player'
}>()

const emit = defineEmits<{
  settings: []
  study: []
  help: []
}>()

const route = useRoute()
const router = useRouter()

const collapsed = ref(false)

onMounted(() => {
  try {
    const saved = localStorage.getItem('study_sidebar_collapsed')
    if (saved !== null) {
      collapsed.value = saved === 'true'
    }
  } catch {
    // 忽略存储读取异常
  }
})

function toggleCollapse() {
  collapsed.value = !collapsed.value
  try {
    localStorage.setItem('study_sidebar_collapsed', String(collapsed.value))
  } catch {
    // 忽略存储异常
  }
}

const isNotesActive = computed(() => route.path === '/' || route.path === '/notes')
const isCoursesActive = computed(() => route.path.startsWith('/courses'))

function navigate(path: string) {
  if (route.path !== path) {
    void router.push(path)
  }
}
</script>

<template>
  <aside
    class="relative flex h-full shrink-0 flex-col border-r border-linen bg-pure-white transition-[width] duration-200 ease-soft select-none"
    :class="collapsed ? 'w-16' : 'w-56'"
    aria-label="主导航"
  >
    <!-- 顶部品牌标志 -->
    <div
      class="flex h-14 shrink-0 items-center border-b border-linen/60 px-4"
      :class="collapsed ? 'justify-center' : 'justify-start gap-2.5'"
    >
      <button
        type="button"
        class="flex items-center gap-2.5 overflow-hidden text-left focus:outline-none"
        title="Study Helper"
        aria-label="Study Helper"
        @click="navigate('/')"
      >
        <span class="h-3.5 w-3.5 shrink-0 rounded-full bg-brand-orange" aria-hidden="true" />
        <span v-if="!collapsed" class="truncate text-body font-bold tracking-[-0.03em] text-charcoal-ink">
          Study Helper
        </span>
      </button>
    </div>

    <!-- 主导航菜单 -->
    <nav class="flex-1 space-y-1.5 overflow-y-auto p-2.5" aria-label="页面导航">
      <button
        type="button"
        class="flex w-full items-center rounded-xl text-body-sm transition-colors duration-150"
        :class="[
          collapsed ? 'h-10 justify-center p-0' : 'gap-3 px-3.5 py-2.5',
          isNotesActive
            ? 'bg-page-cream text-deep-indigo font-bold'
            : 'text-graphite hover:bg-page-cream/60 hover:text-charcoal-ink',
        ]"
        title="笔记"
        aria-label="笔记"
        @click="navigate('/')"
      >
        <AppIcon name="note" :size="18" class="shrink-0" />
        <span v-if="!collapsed" class="truncate">笔记</span>
      </button>

      <button
        type="button"
        class="flex w-full items-center rounded-xl text-body-sm transition-colors duration-150"
        :class="[
          collapsed ? 'h-10 justify-center p-0' : 'gap-3 px-3.5 py-2.5',
          isCoursesActive
            ? 'bg-page-cream text-deep-indigo font-bold'
            : 'text-graphite hover:bg-page-cream/60 hover:text-charcoal-ink',
        ]"
        title="网课学习"
        aria-label="网课学习"
        @click="navigate('/courses')"
      >
        <AppIcon name="graduation" :size="18" class="shrink-0" />
        <span v-if="!collapsed" class="truncate">网课学习</span>
      </button>

      <button
        type="button"
        class="flex w-full items-center rounded-xl text-body-sm text-graphite transition-colors duration-150 hover:bg-page-cream/60 hover:text-charcoal-ink"
        :class="collapsed ? 'h-10 justify-center p-0' : 'gap-3 px-3.5 py-2.5'"
        title="学习管理"
        aria-label="学习管理"
        @click="emit('study')"
      >
        <AppIcon name="bell" :size="18" class="shrink-0" />
        <span v-if="!collapsed" class="truncate">学习管理</span>
      </button>
    </nav>

    <!-- 底部操作与折叠 -->
    <div class="shrink-0 space-y-1 border-t border-linen/60 p-2.5" aria-label="应用设置与快捷操作">
      <button
        type="button"
        class="flex w-full items-center rounded-xl text-body-sm text-graphite transition-colors duration-150 hover:bg-page-cream/60 hover:text-charcoal-ink"
        :class="collapsed ? 'h-10 justify-center p-0' : 'gap-3 px-3.5 py-2'"
        title="设置"
        aria-label="设置"
        @click="emit('settings')"
      >
        <AppIcon name="settings" :size="18" class="shrink-0" />
        <span v-if="!collapsed" class="truncate">设置</span>
      </button>

      <button
        type="button"
        class="flex w-full items-center rounded-xl text-body-sm text-graphite transition-colors duration-150 hover:bg-page-cream/60 hover:text-charcoal-ink"
        :class="collapsed ? 'h-10 justify-center p-0' : 'gap-3 px-3.5 py-2'"
        title="快捷键"
        aria-label="快捷键"
        @click="emit('help')"
      >
        <AppIcon name="keyboard" :size="18" class="shrink-0" />
        <span v-if="!collapsed" class="truncate">快捷键</span>
      </button>

      <button
        type="button"
        class="flex w-full items-center rounded-xl text-body-sm text-stone transition-colors duration-150 hover:bg-page-cream/60 hover:text-graphite"
        :class="collapsed ? 'h-10 justify-center p-0' : 'gap-3 px-3.5 py-2'"
        :title="collapsed ? '展开侧栏' : '收起侧栏'"
        :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
        @click="toggleCollapse"
      >
        <AppIcon :name="collapsed ? 'panel-left-open' : 'panel-left-close'" :size="18" class="shrink-0" />
        <span v-if="!collapsed" class="truncate">收起侧栏</span>
      </button>
    </div>
  </aside>
</template>

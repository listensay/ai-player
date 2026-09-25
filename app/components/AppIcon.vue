<script setup lang="ts">
import { ArrowLeft, Camera, Check, ChevronDown, ChevronRight, Clock, FastForward, Film, FolderOpen, Keyboard, LayoutDashboard, Maximize, Menu, Minimize, NotebookPen, Pause, Play, Rewind, Route, Search, SkipBack, SkipForward, Sparkles, Trash2, Volume2, VolumeX, X } from '@lucide/vue'

// 使用 Lucide 的标准图标，统一圆角描边；不再维护手写 SVG 路径。
const icons = {
  sparkles: Sparkles, route: Route, play: Play, pause: Pause, rewind: Rewind, forward: FastForward,
  'skip-prev': SkipBack, 'skip-next': SkipForward, folder: FolderOpen, film: Film, camera: Camera,
  clock: Clock, 'chevron-right': ChevronRight, 'chevron-down': ChevronDown, volume: Volume2,
  'volume-mute': VolumeX, fullscreen: Maximize, 'fullscreen-exit': Minimize, check: Check,
  search: Search, close: X, keyboard: Keyboard, note: NotebookPen, trash: Trash2, menu: Menu,
  dashboard: LayoutDashboard, 'arrow-left': ArrowLeft,
}
export type IconName = keyof typeof icons
withDefaults(defineProps<{ name: IconName; size?: number | string }>(), { size: 20 })
</script>

<template>
  <component :is="icons[name]" :size="Number(size)" :stroke-width="2.2" aria-hidden="true" focusable="false" class="shrink-0" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAffineView } from '~/composables/useAffineView'
import UiButton from './UiButton.vue'
import { RouterLink } from 'vue-router'

const props = withDefaults(
  defineProps<{ active?: boolean; blocked?: boolean; courseId?: string; path?: string; title?: string }>(),
  { active: true, blocked: false },
)
const host = ref<HTMLElement | null>(null)
const target = computed(() =>
  props.active && !props.blocked
    ? {
        key:
          props.courseId && props.path
            ? JSON.stringify({ courseId: props.courseId, path: props.path, title: props.title || props.path })
            : 'workspace',
        url: 'local-workspace',
      }
    : null,
)
const view = useAffineView(host, target)
</script>

<template>
  <section class="relative flex min-h-0 flex-1 flex-col bg-white" aria-label="学习笔记">
    <div v-if="courseId" class="flex justify-end border-b border-linen px-3 py-2">
      <RouterLink to="/notes" class="text-caption font-bold text-stone hover:text-charcoal-ink"
        >打开笔记工作区 ↗</RouterLink
      >
    </div>
    <div v-if="view.error.value" role="alert" class="flex items-center gap-3 p-4 text-body-sm text-error">
      <span>{{ view.error.value }}</span>
      <UiButton size="sm" @click="view.retry">重试</UiButton>
    </div>
    <div ref="host" class="affine-webview-slot min-h-0 flex-1" />
  </section>
</template>

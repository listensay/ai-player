<script setup lang="ts">
import type { LessonStatus } from '~/types/guide'
import { LESSON_STATUS_LABELS } from '~/utils/guide'
defineProps<{ status: LessonStatus; compact?: boolean }>()
</script>

<template>
  <span class="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold"
    :class="status === 'required' ? 'bg-sunbeam-yellow/25 text-charcoal-ink' : status === 'optional' ? 'bg-deep-indigo/8 text-deep-indigo' : 'bg-page-cream text-stone'">
    {{ compact && status === 'optional' ? '选修' : LESSON_STATUS_LABELS[status] }}
  </span>
</template>

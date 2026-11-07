<script setup lang="ts">
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import { usePageTitle } from '~/composables/usePageTitle'
import CourseDashboard from '~/components/CourseDashboard.vue'
const { course, stats, video, selectVideo, openGuide, startSegment } = useCourseWorkspace()
usePageTitle(() => `${course.value?.name ?? '课程概览'} · Study Helper`)
</script>

<template>
  <CourseDashboard
    v-if="course"
    :course="course"
    :stats="stats"
    :current-video="video"
    @play="selectVideo"
    @segment="startSegment"
    @guide="openGuide($event ?? 'plan')"
  />
</template>

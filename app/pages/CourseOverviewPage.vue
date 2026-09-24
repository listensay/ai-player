<script setup lang="ts">
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import { usePageTitle } from '~/composables/usePageTitle'
import CourseDashboard from '~/components/CourseDashboard.vue'
const { course, stats, video, playVideoFromDashboard, openGuide, startSegment } = useCourseWorkspace()
usePageTitle(() => `${course.value?.name ?? '课程概览'} · AI Player`)
</script>

<template>
    <CourseDashboard
      v-if="course"
      :course="course"
      :stats="stats"
      :current-video="video"
      @play="playVideoFromDashboard"
      @segment="startSegment"
      @guide="openGuide(undefined, $event ?? 'plan')"
    />
</template>

<script setup lang="ts">
import type { useCourseLibraryActions } from '~/composables/useCourseLibraryActions'
import StudyFormDialog from './StudyFormDialog.vue'

const props = defineProps<{ actions: ReturnType<typeof useCourseLibraryActions> }>()
const { courseAction, changing, actionCourse, draftName, actionError, closeCourseAction, submitCourseAction } =
  props.actions
</script>

<template>
  <StudyFormDialog
    :open="courseAction !== null"
    :title="courseAction === 'rename' ? '重命名课程' : '删除课程'"
    title-id="course-action-title"
    :submit-label="courseAction === 'rename' ? '保存' : '删除'"
    :busy="!!changing"
    :error="actionError"
    :width="440"
    @update:open="closeCourseAction"
    @submit="submitCourseAction"
  >
    <VTextField
      v-if="courseAction === 'rename'"
      v-model="draftName"
      label="课程名称"
      placeholder="输入课程名称"
      :disabled="!!changing"
      autofocus
    />
    <p v-else class="text-body-sm text-graphite [overflow-wrap:anywhere]">
      确定从课程库删除「{{ actionCourse?.name }}」？
    </p>
  </StudyFormDialog>
</template>

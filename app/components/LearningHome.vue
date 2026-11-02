<script setup lang="ts">
import { computed } from 'vue'
import { useLearningHome } from '~/composables/useLearningHome'
import CourseLibrary from '~/components/CourseLibrary.vue'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'
import WelcomeScreen from '~/components/WelcomeScreen.vue'
import CourseActionDialog from '~/components/CourseActionDialog.vue'
import { useCourseLibraryActions } from '~/composables/useCourseLibraryActions'

const home = useLearningHome()
const { courses, loading, error, date } = home

const actions = useCourseLibraryActions(home)
const { store, changing, go, update, editCourse } = actions
const partial = computed(() => courses.value.some((c) => c.error))
async function openFolder() {
  if (await store.openFolder()) await go(store.state.library.find((c) => c.id === store.state.course?.id)!)
}
</script>

<template>
  <div v-if="loading && !courses.length" class="w-full p-8 text-body-sm text-stone" role="status">
    正在读取学习记录…
  </div>
  <div v-else-if="error && !courses.length" class="pane mx-auto my-10 max-w-lg p-6">
    <p role="alert" class="text-error">{{ error }}</p>
    <UiButton class="mt-4" @click="home.refresh">重试</UiButton>
  </div>
  <WelcomeScreen v-else-if="!courses.length" />
  <div v-else class="learning-home mx-auto w-full max-w-[1440px] px-5 py-5 sm:px-7 lg:px-9 lg:py-6">
    <header class="flex items-center justify-end">
      <div class="flex items-center gap-2.5">
        <UiButton icon title="刷新课程" variant="text" size="sm" :disabled="loading" @click="home.refresh">
          <AppIcon name="reset" :size="16" :class="{ 'animate-spin': loading }" />
        </UiButton>
        <UiButton
          variant="dark"
          size="sm"
          class="rounded-full px-4 shadow-subtle"
          :disabled="store.state.loading || !!changing"
          @click="openFolder"
        >
          <AppIcon name="folder" :size="16" />
          <span>打开课程</span>
        </UiButton>
      </div>
    </header>

    <p v-if="error || store.state.error" role="alert" class="mt-4 text-body-sm text-error">
      {{ error || store.state.error }}
    </p>
    <p v-if="partial" role="status" class="mt-4 text-caption text-error">部分课程读取失败。</p>

    <div class="home-layout">
      <div class="min-w-0">
        <CourseLibrary
          :courses="courses"
          :date="date"
          :changing="changing"
          @open="go"
          @update="update"
          @rename="editCourse($event, 'rename')"
          @delete="editCourse($event, 'delete')"
        />
      </div>
    </div>
  </div>
  <CourseActionDialog :actions="actions" />
</template>

<style scoped>
.home-layout {
  margin-top: 24px;
}
</style>

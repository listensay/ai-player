<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCourseStore } from '~/composables/useCourseStore'
import { useLearningHome } from '~/composables/useLearningHome'
import type { LibraryCourse } from '~/types/course'
import CourseLibrary from '~/components/CourseLibrary.vue'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'
import WelcomeScreen from '~/components/WelcomeScreen.vue'
import StudyFormDialog from '~/components/StudyFormDialog.vue'

const store = useCourseStore(),
  router = useRouter(),
  home = useLearningHome()
const { courses, loading, error, date } = home

const changing = ref('')
const courseAction = ref<'rename' | 'delete' | null>(null)
const actionCourse = ref<LibraryCourse | null>(null)
const draftName = ref('')
const actionError = ref('')

function editCourse(course: LibraryCourse, action: 'rename' | 'delete') {
  if (changing.value || store.state.loading) return
  actionCourse.value = course
  draftName.value = course.name
  actionError.value = ''
  courseAction.value = action
}
function closeCourseAction(open: boolean) {
  if (!open && !changing.value) courseAction.value = null
}
async function submitCourseAction() {
  const course = actionCourse.value
  const action = courseAction.value
  if (!course || !action || changing.value) return
  changing.value = course.id
  actionError.value = ''
  try {
    if (action === 'rename') course.name = await store.renameCourse(course.id, draftName.value)
    else {
      await store.deleteCourse(course.id)
      courses.value = courses.value.filter((entry) => entry.course.id !== course.id)
    }
    await home.refresh()
    courseAction.value = null
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error)
  } finally {
    changing.value = ''
  }
}

const partial = computed(() => courses.value.some((c) => c.error))

function go(
  course: LibraryCourse,
  view: 'overview' | 'player' | 'today' | 'practice' = 'overview',
  path?: string,
  seconds?: number,
) {
  if (changing.value) return
  return router.push({
    path: `/courses/${encodeURIComponent(course.id)}${view === 'player' ? '/player' : ''}`,
    query: {
      ...(view === 'player' ? { autoplay: '1' } : {}),
      ...(view === 'player' && (path ?? course.lastVideoPath) ? { lesson: path ?? course.lastVideoPath } : {}),
      ...(seconds !== undefined ? { at: String(seconds) } : {}),
      ...(view === 'today' || view === 'practice' ? { panel: view } : {}),
    },
  })
}

async function openFolder() {
  if (await store.openFolder()) await go(store.state.library.find((c) => c.id === store.state.course?.id)!)
}

async function update(course: LibraryCourse, patch: Partial<Pick<LibraryCourse, 'status' | 'pinned'>>) {
  if (changing.value) return
  changing.value = course.id
  try {
    if (await store.updateLibrary(course.id, patch)) {
      Object.assign(course, patch)
      await home.refresh()
    }
  } finally {
    changing.value = ''
  }
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

<style scoped>
.home-layout {
  margin-top: 24px;
}
</style>

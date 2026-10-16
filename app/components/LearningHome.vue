<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useCourseStore } from '~/composables/useCourseStore'
import { useLearningHome } from '~/composables/useLearningHome'
import type { LibraryCourse } from '~/types/course'
import { formatMinutes } from '~/utils/studyProgram'
import CourseLibrary from '~/components/CourseLibrary.vue'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'
import WelcomeScreen from '~/components/WelcomeScreen.vue'
import StudyFormDialog from '~/components/StudyFormDialog.vue'

const store = useCourseStore(),
  router = useRouter(),
  home = useLearningHome()
const { courses, loading, error, date, availableMinutes, today, week, weekOffset } = home

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

const weekTaskCount = computed(() => week.value.flatMap((day) => day.tasks))
const maxWeek = computed(() => Math.max(3600, ...week.value.map((day) => day.videoSeconds + day.workSeconds)))
const weekSeconds = computed(() => week.value.reduce((n, day) => n + day.videoSeconds + day.workSeconds, 0))
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
      <aside class="home-summary pane rounded-3xl p-5" aria-label="学习投入概览">
        <section class="min-w-0" aria-label="今日投入">
          <h2 class="text-body font-bold text-charcoal-ink">今日投入</h2>
          <p class="mt-3 text-heading font-bold text-charcoal-ink">
            {{ formatMinutes(Math.floor((today.videoSeconds + today.workSeconds) / 60)) }}
          </p>
          <p class="mt-1 text-caption text-stone">
            观看 {{ formatMinutes(Math.floor(today.videoSeconds / 60)) }} · 实践
            {{ formatMinutes(Math.floor(today.workSeconds / 60)) }}
          </p>
          <div class="mt-4 border-t border-linen/70 pt-4">
            <VTextField
              v-model.number="availableMinutes"
              density="compact"
              type="number"
              min="0"
              max="1440"
              label="每日可用时间（分钟）"
              hide-details
              @change="home.saveAvailable(availableMinutes)"
            />
          </div>
        </section>

        <section class="home-summary-week min-w-0" aria-label="每周学习概览">
          <div class="flex items-center justify-between gap-2 border-b border-linen/70 pb-3">
            <h2 class="text-body font-bold text-charcoal-ink">{{ weekOffset === 0 ? '本周概览' : '每周概览' }}</h2>
            <div class="flex items-center gap-1">
              <UiButton icon size="sm" variant="ghost" title="上一周" @click="home.moveWeek(-1)">
                <AppIcon name="arrow-left" :size="15" />
              </UiButton>
              <UiButton
                icon
                size="sm"
                variant="ghost"
                title="下一周"
                :disabled="weekOffset >= 0"
                @click="home.moveWeek(1)"
              >
                <AppIcon name="chevron-right" :size="15" />
              </UiButton>
            </div>
          </div>
          <p class="mt-3 text-caption text-stone">{{ week[0]?.date }} — {{ week[6]?.date }}</p>
          <p class="mt-1 text-heading-sm font-bold text-charcoal-ink">
            {{ formatMinutes(Math.floor(weekSeconds / 60)) }}
          </p>
          <p v-if="weekTaskCount.length" class="mt-1 text-caption text-stone">
            已完成任务 {{ weekTaskCount.filter((task) => task.done).length }} / {{ weekTaskCount.length }}
          </p>
          <div class="mt-5 grid grid-cols-7 gap-1.5" aria-label="每日实际投入">
            <div
              v-for="day in week"
              :key="day.date"
              class="min-w-0 rounded-xl px-1 py-2 text-center"
              :class="date === day.date ? 'bg-page-cream ring-1 ring-deep-indigo' : ''"
              role="img"
              :aria-label="`${day.date}，投入${Math.floor((day.videoSeconds + day.workSeconds) / 60)}分钟`"
              :title="`${day.date}，投入${Math.floor((day.videoSeconds + day.workSeconds) / 60)}分钟`"
            >
              <span class="flex h-20 items-end justify-center rounded-lg bg-page-cream/60 p-1">
                <span
                  class="w-3.5 rounded-t-sm bg-deep-indigo transition-all duration-200"
                  :style="{
                    height: `${Math.max(4, ((day.videoSeconds + day.workSeconds) / maxWeek) * 100)}%`,
                    opacity: day.videoSeconds + day.workSeconds ? 1 : 0.2,
                  }"
                />
              </span>
              <span class="mt-2 block text-[11px] font-medium text-stone tabular">{{ day.date.slice(8) }}</span>
            </div>
          </div>
        </section>
      </aside>
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
.learning-home {
  container-type: inline-size;
}
.home-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  align-items: start;
  gap: 28px;
  margin-top: 24px;
}
.home-summary {
  display: grid;
  min-width: 0;
  gap: 24px;
}
.home-summary-week {
  border-top: 1px solid var(--color-linen);
  padding-top: 24px;
}
@container (max-width: 1000px) {
  .home-layout {
    grid-template-columns: minmax(0, 1fr) 260px;
    gap: 20px;
  }
}
@container (max-width: 800px) {
  .home-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .home-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }
  .home-summary-week {
    border-top: 0;
    border-left: 1px solid var(--color-linen);
    padding-top: 0;
    padding-left: 24px;
  }
}
@container (max-width: 560px) {
  .home-summary {
    grid-template-columns: minmax(0, 1fr);
  }
  .home-summary-week {
    border-top: 1px solid var(--color-linen);
    border-left: 0;
    padding-top: 24px;
    padding-left: 0;
  }
}
</style>

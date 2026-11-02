<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
import CourseCard from '~/components/CourseCard.vue'
import CourseActionDialog from '~/components/CourseActionDialog.vue'
import { useLearningHome } from '~/composables/useLearningHome'
import { useCourseLibraryActions } from '~/composables/useCourseLibraryActions'
import type { LibraryCourse } from '~/types/course'
import { usePageTitle } from '~/composables/usePageTitle'
import { continueLearning, totalCourseStudyTime, formatHomeDuration as duration } from '~/utils/homeDashboard'

usePageTitle('首页 · Study Helper')
const home = useLearningHome()
const { courses, loading, error, date, today, week, weekOffset, selectedDate, selected } = home
const actions = useCourseLibraryActions(home)
const { store, changing, update, editCourse } = actions
const resumes = computed(() =>
  continueLearning(courses.value).map((resume) => ({
    ...resume,
    entry: courses.value.find((entry) => entry.course.id === resume.id)!,
  })),
)
function openCourse(course: LibraryCourse, view: 'overview' | 'player' | 'today' = 'overview') {
  return actions.go(
    course,
    view,
    view === 'player' ? resumes.value.find((resume) => resume.id === course.id)?.path : undefined,
  )
}
const total = computed(() => totalCourseStudyTime(courses.value, date.value))
const weekSeconds = computed(() => week.value.reduce((sum, day) => sum + day.videoSeconds + day.workSeconds, 0))
const maxWeek = computed(() => Math.max(60, ...week.value.map((day) => day.videoSeconds + day.workSeconds)))
const partial = computed(() => courses.value.some((course) => course.error))
const dateLabel = computed(() =>
  new Date(`${date.value}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }),
)
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
</script>

<template>
  <main class="home-page scroll-soft min-h-0 flex-1 overflow-y-auto" aria-label="学习首页">
    <div class="home-shell mx-auto w-full max-w-[1320px]">
      <header class="mb-6 flex items-center justify-between gap-4">
        <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 class="text-heading font-bold">首页</h1>
          <p class="text-body-sm text-stone">{{ dateLabel }}</p>
        </div>
        <UiButton icon size="sm" variant="text" title="刷新首页" :disabled="loading" @click="home.refresh"
          ><AppIcon name="reset" :size="18" :class="{ 'animate-spin': loading }"
        /></UiButton>
      </header>
      <p v-if="store.state.error" class="mb-5 text-body-sm text-error" role="alert">{{ store.state.error }}</p>
      <div v-if="error || partial" class="mb-5 flex items-center gap-3 text-body-sm text-error" role="alert">
        <span>{{ error ? '学习记录读取失败。' : '部分课程读取失败。' }}</span>
        <UiButton size="sm" variant="text" @click="home.refresh">重试</UiButton>
      </div>
      <p v-if="loading && !courses.length" class="mb-5 text-body-sm text-stone" role="status">正在读取学习记录…</p>

      <div class="home-summary-grid">
        <section class="study-time-card rounded-3xl p-6" aria-label="累计学习时长">
          <div class="flex items-center justify-between">
            <h2 class="text-subheading font-bold">累计学习时长</h2>
            <AppIcon name="clock" :size="23" />
          </div>
          <p class="my-6 text-heading-lg font-bold tabular">{{ duration(total.videoSeconds + total.workSeconds) }}</p>
          <dl class="grid grid-cols-2 gap-5 border-t border-charcoal-ink/15 pt-5">
            <div>
              <dt class="text-caption text-graphite">网课学习</dt>
              <dd class="mt-1 text-body font-bold tabular">{{ duration(total.videoSeconds) }}</dd>
            </div>
            <div>
              <dt class="text-caption text-graphite">实践</dt>
              <dd class="mt-1 text-body font-bold tabular">{{ duration(total.workSeconds) }}</dd>
            </div>
          </dl>
          <p class="mt-5 text-caption text-graphite">今日投入 {{ duration(today.videoSeconds + today.workSeconds) }}</p>
        </section>

        <section class="pane min-w-0 rounded-3xl p-6" aria-label="本周学习趋势">
          <header class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-subheading font-bold">{{ weekOffset === 0 ? '本周学习趋势' : '每周学习趋势' }}</h2>
            <div class="flex items-center gap-1">
              <UiButton size="sm" icon variant="text" title="上一周" @click="home.moveWeek(-1)"
                ><AppIcon name="arrow-left" :size="16"
              /></UiButton>
              <UiButton v-if="weekOffset !== 0" size="sm" variant="text" @click="home.moveWeek(-weekOffset)"
                >本周</UiButton
              >
              <UiButton
                size="sm"
                icon
                variant="text"
                title="下一周"
                :disabled="weekOffset >= 0"
                @click="home.moveWeek(1)"
                ><AppIcon name="chevron-right" :size="16"
              /></UiButton>
            </div>
          </header>
          <div class="mt-3 flex flex-wrap items-baseline justify-between gap-2">
            <p class="text-heading-sm font-bold tabular">{{ duration(weekSeconds) }}</p>
            <p class="text-caption text-stone">{{ week[0]?.date.slice(5) }} — {{ week[6]?.date.slice(5) }}</p>
          </div>
          <div class="mt-3 grid grid-cols-7 gap-2" aria-label="每日学习时长">
            <button
              v-for="(day, index) in week"
              :key="day.date"
              type="button"
              class="trend-day min-w-0 rounded-xl px-1 py-2"
              :class="{ 'trend-day-selected': selectedDate === day.date }"
              :disabled="day.date > date"
              :aria-pressed="selectedDate === day.date"
              :aria-label="`${day.date}，网课 ${duration(day.videoSeconds)}，实践 ${duration(day.workSeconds)}`"
              @click="selectedDate = day.date"
            >
              <span class="flex h-20 items-end justify-center" aria-hidden="true">
                <span
                  class="flex w-5 flex-col-reverse overflow-hidden rounded-t-md"
                  :style="{ height: `${((day.videoSeconds + day.workSeconds) / maxWeek) * 100}%` }"
                >
                  <span
                    class="bg-deep-indigo"
                    :style="{
                      height: `${(day.videoSeconds / Math.max(1, day.videoSeconds + day.workSeconds)) * 100}%`,
                    }"
                  />
                  <span
                    class="bg-sunbeam-yellow"
                    :style="{ height: `${(day.workSeconds / Math.max(1, day.videoSeconds + day.workSeconds)) * 100}%` }"
                  />
                </span>
              </span>
              <span
                class="mt-2 block text-caption"
                :class="day.date === date ? 'font-bold text-deep-indigo' : 'text-stone'"
                >{{ day.date === date ? '今天' : weekdays[index] }}</span
              >
            </button>
          </div>
          <p class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-stone" aria-live="polite">
            <span>{{ selectedDate.slice(5) }}</span>
            <span class="inline-flex items-center gap-1.5"
              ><i class="h-2 w-2 rounded-full bg-deep-indigo" aria-hidden="true" />网课
              {{ duration(selected.videoSeconds) }}</span
            >
            <span class="inline-flex items-center gap-1.5"
              ><i class="h-2 w-2 rounded-full bg-sunbeam-yellow" aria-hidden="true" />实践
              {{ duration(selected.workSeconds) }}</span
            >
          </p>
        </section>
      </div>

      <section class="my-6" aria-label="继续学习">
        <header class="mb-4 flex items-center justify-between gap-3">
          <h2 class="text-subheading font-bold">继续学习</h2>
          <UiButton to="/courses" size="sm" variant="text"
            >全部课程<AppIcon name="chevron-right" :size="16"
          /></UiButton>
        </header>
        <div v-if="resumes.length" class="resume-grid">
          <CourseCard
            v-for="course in resumes"
            :key="course.id"
            :entry="course.entry"
            :date="date"
            :changing="changing"
            :index="courses.findIndex((entry) => entry.course.id === course.id)"
            heading-tag="h3"
            class="resume-card"
            :aria-label="`继续学习：${course.name}`"
            @open="openCourse"
            @update="update"
            @rename="editCourse($event, 'rename')"
            @delete="editCourse($event, 'delete')"
          />
        </div>
        <div v-else class="pane flex flex-wrap items-center justify-between gap-3 rounded-3xl p-6">
          <p class="text-body-sm text-stone">{{ courses.length ? '暂无可继续的课程' : '还没有课程' }}</p>
          <UiButton to="/courses" size="sm" variant="primary"
            >{{ courses.length ? '查看课程' : '添加课程' }}<AppIcon name="chevron-right" :size="16"
          /></UiButton>
        </div>
      </section>
    </div>
  </main>
  <CourseActionDialog :actions="actions" />
</template>

<style scoped>
.home-page {
  padding: 28px 32px 40px;
  container-type: inline-size;
}
.home-summary-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.65fr);
  gap: 24px;
}
.study-time-card {
  background: var(--color-sunbeam-yellow);
}
.resume-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.trend-day {
  border: 1px solid transparent;
}
.trend-day-selected {
  background: var(--color-page-cream);
  border-color: var(--color-linen);
}
.trend-day:disabled {
  opacity: 0.4;
}
@container (max-width: 760px) {
  .home-summary-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@container (max-width: 440px) {
  .resume-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 900px) {
  .home-page {
    padding: 24px 20px;
  }
}
</style>

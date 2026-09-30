<script setup lang="ts">

import { provideCourseWorkspace } from '~/composables/useCourseWorkspace'
import { useRouter } from 'vue-router'
import AppTopBar from '~/components/AppTopBar.vue'
import UiButton from '~/components/UiButton.vue'
import StudyReminderNotice from '~/components/StudyReminderNotice.vue'
import GuideDialog from '~/components/GuideDialog.vue'
import PracticeDialog from '~/components/PracticeDialog.vue'
import ShortcutsDialog from '~/components/ShortcutsDialog.vue'
import { RouterView } from 'vue-router'
import { useProgress } from '~/composables/useProgress'
import { onMounted } from 'vue'
import { pruneAiBatchCache } from '~/utils/aiBatchTask'
onMounted(() => { void pruneAiBatchCache() })
const progress = useProgress()
const router = useRouter()
const {
  stats, transcripts, helpOpen, guideOpen, guideTab, reminderLinks, companion,
  currentView, toast, course, video, practice, daily, openDailyPractice, openPractice, openGuide, startSegment, selectGuideVideo,
} = provideCourseWorkspace()
</script>

<template>
  <VApp>
  <div :inert="helpOpen || guideOpen || practice.state.open || daily.practice.state.open" class="flex h-dvh flex-col overflow-hidden bg-page-cream text-charcoal-ink">
    <AppTopBar
      :course-name="course?.name"
      :course-id="course?.id"
      :video-path="video?.path"
      :total="stats.total"
      :done="stats.done"
      :current-view="currentView"
      @help="helpOpen = true"
      @close="router.push('/')"
      @guide="openGuide()"
      @companion="companion.openMini()"
    />

    <aside v-if="transcripts.activeJobs.value" aria-label="后台转写任务" class="shrink-0 border-b border-linen bg-sunbeam-yellow/15 px-4 py-2 text-caption">
      <div v-for="task in transcripts.tasks.value" :key="`${task.courseId}:${task.path}`" class="flex items-center gap-3">
        <span class="min-w-0 flex-1 truncate">正在转写：{{ task.title }} · {{ task.progress === null ? '等待处理' : `${Math.round(task.progress * 100)}%` }}</span>
        <button type="button" class="font-bold" @click="router.push({ path: `/courses/${task.courseId}/player`, query: { lesson: task.path } })">查看课节</button>
        <button type="button" class="text-stone" @click="transcripts.cancel(task.courseId, task.path)">取消任务</button>
      </div>
    </aside>
    <aside v-if="reminderLinks.error.value" role="alert" class="flex shrink-0 items-center justify-between gap-3 border-b border-linen bg-pure-white px-5 py-3 text-body-sm">
      <p>{{ reminderLinks.error.value }}</p><UiButton size="sm" @click="reminderLinks.retry()">重试打开</UiButton>
    </aside>
    <aside v-if="progress.state.error" role="alert" class="flex shrink-0 items-center justify-between gap-3 border-b border-linen bg-pure-white px-5 py-3 text-body-sm">
      <p>{{ progress.state.error }}</p><UiButton size="sm" :disabled="progress.state.loading || progress.state.saving" @click="progress.retry().catch(() => {})">{{ progress.state.ready ? '重试保存' : '重试读取' }}</UiButton>
    </aside>
    <StudyReminderNotice />
    <RouterView />

    <!-- 轻提示 -->
    <Transition
      enter-active-class="transition duration-150 ease-soft"
      enter-from-class="translate-y-2 opacity-0"
      leave-active-class="transition duration-150 ease-soft"
      leave-to-class="opacity-0"
    >
      <div
        v-if="toast"
        role="status"
        class="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-charcoal-ink px-4 py-2 text-body-sm font-medium text-pure-white shadow-subtle"
      >
        {{ toast }}
      </div>
    </Transition>

    <ShortcutsDialog :open="helpOpen" @close="helpOpen = false" />
    <GuideDialog v-if="course" :key="course.id" :open="guideOpen" :initial-tab="guideTab"
      @close="guideOpen = false" @select="selectGuideVideo" @segment="startSegment" />
    <PracticeDialog v-if="course" :practice="practice" @retry="openPractice(practice.state.scope)" @settings="openGuide('settings')" @seek="selectGuideVideo" />
    <PracticeDialog v-if="course" :practice="daily.practice" @retry="openDailyPractice" @settings="openGuide('settings')" @seek="selectGuideVideo" />
  </div>
  </VApp>
</template>

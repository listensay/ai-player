<script setup lang="ts">
import FlowCheckInPrompt from '~/components/FlowCheckInPrompt.vue'
import AppUtilityDialog from '~/components/AppUtilityDialog.vue'
import { isAppDialogKind } from '~/composables/useAppDialogs'
import { provideCourseWorkspace } from '~/composables/useCourseWorkspace'
import { useRoute, useRouter } from 'vue-router'
import AppTopBar from '~/components/AppTopBar.vue'
import PlayerStudyHeader from '~/components/PlayerStudyHeader.vue'
import UiButton from '~/components/UiButton.vue'
import StudyReminderNotice from '~/components/StudyReminderNotice.vue'
import GuideDialog from '~/components/GuideDialog.vue'
import PracticeDialog from '~/components/PracticeDialog.vue'
import ShortcutsDialog from '~/components/ShortcutsDialog.vue'
import { RouterView } from 'vue-router'
import { useProgress } from '~/composables/useProgress'
import { onMounted, watch } from 'vue'
import { pruneAiBatchCache } from '~/utils/aiBatchTask'
import { useNoteAiBridge } from '~/composables/useNoteAiBridge'
onMounted(() => {
  void pruneAiBatchCache()
})
const progress = useProgress()
const router = useRouter()
const route = useRoute()
const {
  appDialogs,
  stats,
  helpOpen,
  guideOpen,
  guideTab,
  reminderLinks,
  currentView,
  toast,
  course,
  guide,
  practice,
  daily,
  openDailyPractice,
  openPractice,
  openGuide,
  startSegment,
  selectGuideVideo,
} = provideCourseWorkspace()
useNoteAiBridge(guide.state.settings)
// Preserve old saved links while all in-app entries open overlays without navigation.
watch(
  () => route.query.dialog,
  (kind) => {
    if (!isAppDialogKind(kind)) return
    appDialogs.open(kind, typeof route.query.section === 'string' ? route.query.section : undefined)
    const { dialog: _dialog, section: _section, ...query } = route.query
    void router.replace({ path: route.path, query })
  },
  { immediate: true },
)
</script>

<template>
  <VApp>
    <div
      :inert="appDialogs.isOpen.value || helpOpen || guideOpen || practice.state.open || daily.practice.state.open"
      class="flex h-dvh flex-col overflow-hidden bg-page-cream text-charcoal-ink"
    >
      <AppTopBar
        :course-name="course?.name"
        :total="stats.total"
        :done="stats.done"
        :current-view="currentView"
        @settings="appDialogs.open('settings')"
        @study="appDialogs.open('study')"
        @back="router.push(course ? `/courses/${course.id}` : '/')"
        @help="helpOpen = true"
        @close="router.push('/')"
        @guide="openGuide()"
        @notes="router.push('/notes')"
      >
        <template v-if="course && currentView === 'player'" #center>
          <PlayerStudyHeader />
        </template>
      </AppTopBar>

      <aside
        v-if="reminderLinks.error.value"
        role="alert"
        class="flex shrink-0 items-center justify-between gap-3 border-b border-linen bg-pure-white px-5 py-3 text-body-sm"
      >
        <p>{{ reminderLinks.error.value }}</p>
        <UiButton size="sm" @click="reminderLinks.retry()">重试打开</UiButton>
      </aside>
      <aside
        v-if="progress.state.error"
        role="alert"
        class="flex shrink-0 items-center justify-between gap-3 border-b border-linen bg-pure-white px-5 py-3 text-body-sm"
      >
        <p>{{ progress.state.error }}</p>
        <UiButton
          size="sm"
          :disabled="progress.state.loading || progress.state.saving"
          @click="progress.retry().catch(() => {})"
          >{{ progress.state.ready ? '重试保存' : '重试读取' }}</UiButton
        >
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
    </div>
    <ShortcutsDialog :open="helpOpen" @close="helpOpen = false" />
    <GuideDialog
      v-if="course"
      :key="course.id"
      :open="guideOpen"
      :initial-tab="guideTab"
      @close="guideOpen = false"
      @select="selectGuideVideo"
      @segment="startSegment"
    />
    <PracticeDialog
      v-if="course"
      :practice="practice"
      @retry="openPractice(practice.state.scope)"
      @settings="openGuide('settings')"
      @seek="selectGuideVideo"
    />
    <PracticeDialog
      v-if="course"
      :practice="daily.practice"
      @retry="openDailyPractice"
      @settings="openGuide('settings')"
      @seek="selectGuideVideo"
    />
    <AppUtilityDialog />
    <FlowCheckInPrompt />
  </VApp>
</template>

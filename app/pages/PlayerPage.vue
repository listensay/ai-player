<script setup lang="ts">
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import { usePageTitle } from '~/composables/usePageTitle'
import { formatTime } from '~/utils/time'
import AppIcon from '~/components/AppIcon.vue'
import CourseTree from '~/components/CourseTree.vue'
import LazyNoteEditor from '~/components/LazyNoteEditor.vue'
import TranscriptPanel from '~/components/TranscriptPanel.vue'
import LessonKnowledgePanel from '~/components/LessonKnowledgePanel.vue'
import DailyPracticeCard from '~/components/DailyPracticeCard.vue'
import UiButton from '~/components/UiButton.vue'
import VideoStage from '~/components/VideoStage.vue'
import { formatStudyClock, formatStudyHours } from '~/utils/checkIn'
const {
  player,
  noteEditor,
  stage,
  treeOpen,
  desktopTreeOpen,
  treeVisible,
  toggleTree,
  rightPanelOpen,
  rightTab,
  transcripts,
  course,
  video,
  guide,
  segment,
  checkIn,
  hasPrev,
  hasNext,
  onVideoSample,
  navigateEpisode,
  openGuide,
  openPractice,
  practiceSegment,
  completeSegment,
  noteAfterSegment,
  selectGuideVideo,
  selectVideo,
  startSegment,
  insertTimestamp,
  screenshot,
  seekTo,
  quoteToNote,
  showToast,
} = useCourseWorkspace()
function bindStage(instance: unknown) {
  stage.value = instance as typeof stage.value
}
function bindNoteEditor(instance: unknown) {
  noteEditor.value = instance as typeof noteEditor.value
}
usePageTitle(() => `${video.value?.title ?? '播放器'} · AI Player`)
</script>

<template>
  <main v-if="course" class="relative flex min-h-0 flex-1 overflow-hidden">
    <div
      class="player-layout scroll-soft grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:overflow-hidden"
      :class="{ 'directory-collapsed': !desktopTreeOpen, 'right-panel-collapsed': !rightPanelOpen }"
    >
      <!-- 目录：大屏可收起侧栏，小屏作为抽屉；隐藏时保留筛选状态。 -->
      <div
        id="player-course-directory"
        class="min-h-0 min-w-0 lg:static"
        :class="[
          treeOpen ? 'fixed inset-x-4 top-[72px] bottom-4 z-30' : 'max-lg:hidden',
          desktopTreeOpen ? 'lg:flex lg:flex-col' : 'lg:hidden',
        ]"
      >
        <CourseTree
          :course="course"
          :current-path="video?.path ?? null"
          class="h-full"
          @select="selectVideo"
          @guide="openGuide()"
          @start="selectGuideVideo($event)"
          @start-today="startSegment"
        >
          <template #header-actions>
            <button
              type="button"
              class="sidebar-toggle"
              title="收起左侧目录"
              aria-label="收起左侧目录"
              :aria-expanded="treeVisible"
              aria-controls="player-course-directory"
              @click="toggleTree"
            >
              <AppIcon name="panel-left-close" :size="18" />
            </button>
          </template>
        </CourseTree>
      </div>
      <div
        v-if="treeOpen"
        class="fixed inset-0 z-20 bg-charcoal-ink/30 lg:hidden"
        aria-hidden="true"
        @click="treeOpen = false"
      />

      <!-- 舞台 + 控制条 -->
      <div class="flex min-h-[60dvh] min-w-0 flex-col lg:min-h-0">
        <button
          type="button"
          class="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-linen bg-pure-white p-3 text-left transition-colors hover:border-charcoal-ink/30"
          @click="openGuide('today')"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-body-sm font-bold">今日学习</span>
              <span
                v-if="checkIn.isAchieved.value"
                class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-caption font-bold text-emerald-800"
              >
                <AppIcon name="check" :size="12" /> 今日已打卡
              </span>
              <span v-else class="text-caption font-bold text-stone"> 打卡进度 {{ checkIn.percent.value }}% </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-caption text-stone">
              <span
                >{{ guide.state.today?.items.filter((i) => i.done).length ?? 0 }}/{{
                  guide.state.today?.items.length ?? 0
                }}
                项完成</span
              >
              <span>·</span>
              <span
                >已学 {{ formatStudyClock(checkIn.seconds.value) }} / 目标
                {{ formatStudyHours(checkIn.targetSeconds.value) }}</span
              >
              <span v-if="checkIn.streak.value > 0" class="font-medium text-deep-indigo"
                >· 连续打卡 {{ checkIn.streak.value }} 天</span
              >
            </div>
          </div>
          <span class="shrink-0 text-caption font-bold text-charcoal-ink">查看学习计划 →</span>
        </button>
        <DailyPracticeCard class="mb-3 shrink-0" />
        <VideoStage
          v-if="video"
          :ref="bindStage"
          :key="`${course.id}:${video.path}`"
          :video="video"
          :course-id="course.id"
          :has-prev="hasPrev"
          :has-next="hasNext"
          @prev="navigateEpisode(-1)"
          @next="navigateEpisode(1)"
          @sample="onVideoSample"
          @practice="openPractice()"
        >
          <template #reminder>
            <section
              v-if="segment.reminder.value"
              role="status"
              aria-label="学习片段结束提醒"
              class="shrink-0 rounded-2xl border border-linen p-4 text-charcoal-ink"
              :class="player.state.fullscreen ? 'bg-page-cream' : 'bg-sunbeam-yellow/20'"
            >
              <p class="text-body-sm font-bold">本次学习片段已结束</p>
              <p class="mt-1 text-caption text-stone">结束时间 {{ formatTime(segment.reminder.value.end, true) }}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <UiButton size="sm" @click="practiceSegment">开始练习</UiButton>
                <UiButton variant="ghost" size="sm" @click="noteAfterSegment">记录笔记</UiButton>
                <UiButton variant="ghost" size="sm" @click="completeSegment">标记片段完成</UiButton>
                <UiButton variant="text" size="sm" @click="segment.dismiss()">收起提醒</UiButton>
              </div>
            </section>
          </template>
        </VideoStage>
        <p v-if="video && segment.active.value" class="mt-3 shrink-0 text-caption text-stone">
          本次片段 {{ formatTime(segment.active.value.start, true) }}–{{
            formatTime(
              player.state.duration > 0
                ? Math.min(segment.active.value.end, player.state.duration)
                : segment.active.value.end,
              true,
            )
          }}
        </p>
      </div>

      <!-- 笔记 / 逐字稿 -->
      <div
        v-show="rightPanelOpen"
        id="player-learning-panel"
        class="pane flex min-h-[60dvh] min-w-0 flex-col lg:min-h-0"
      >
        <div class="flex shrink-0 items-center gap-1 border-b border-linen px-3 pt-3 pb-2">
          <div
            v-if="video"
            class="flex min-w-0 flex-1 flex-wrap items-center gap-1"
            role="tablist"
            aria-label="右侧面板"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="rightTab === 'notes'"
              class="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-body-sm font-bold transition-colors duration-100 ease-soft"
              :class="rightTab === 'notes' ? 'bg-charcoal-ink text-pure-white' : 'text-graphite hover:bg-cream-deep'"
              @click="rightTab = 'notes'"
            >
              <AppIcon name="note" :size="15" />
              笔记
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="rightTab === 'knowledge'"
              class="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-body-sm font-bold transition-colors"
              :class="
                rightTab === 'knowledge' ? 'bg-sunbeam-yellow text-charcoal-ink' : 'text-graphite hover:bg-cream-deep'
              "
              @click="rightTab = 'knowledge'"
            >
              知识点
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="rightTab === 'transcript'"
              class="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-body-sm font-bold transition-colors duration-100 ease-soft"
              :class="
                rightTab === 'transcript' ? 'bg-charcoal-ink text-pure-white' : 'text-graphite hover:bg-cream-deep'
              "
              @click="rightTab = 'transcript'"
            >
              逐字稿
              <span
                v-if="transcripts.get(course.id, video.path).status === 'transcribing'"
                class="tabular rounded-full bg-sunbeam-yellow px-1.5 text-caption text-charcoal-ink"
                :title="'转写中'"
              >
                {{
                  transcripts.get(course.id, video.path).progress === null
                    ? '…'
                    : `${Math.round((transcripts.get(course.id, video.path).progress ?? 0) * 100)}%`
                }}
              </span>
              <span
                v-else-if="transcripts.get(course.id, video.path).status === 'ready'"
                class="h-1.5 w-1.5 rounded-full"
                :class="rightTab === 'transcript' ? 'bg-sunbeam-yellow' : 'bg-charcoal-ink'"
                aria-hidden="true"
              />
            </button>
          </div>
          <button
            type="button"
            class="sidebar-toggle ml-auto"
            title="收起右侧面板"
            aria-label="收起右侧面板"
            :aria-expanded="true"
            aria-controls="player-learning-panel"
            @click="rightPanelOpen = false"
          >
            <AppIcon name="panel-right-close" :size="18" />
          </button>
        </div>

        <LessonKnowledgePanel v-if="video" v-show="rightTab === 'knowledge'" />
        <LazyNoteEditor
          v-if="video"
          v-show="rightTab === 'notes'"
          :active="rightPanelOpen && rightTab === 'notes'"
          :ref="bindNoteEditor"
          :key="`${course.id}:${video.path}`"
          :video="video"
          :course-id="course.id"
          class="flex-1 border-0"
          @seek="seekTo"
        >
          <template #actions>
            <UiButton
              variant="dark"
              size="sm"
              title="截取当前画面到笔记（⌥S）"
              :disabled="!player.state.ready"
              @click="screenshot"
            >
              <AppIcon name="camera" :size="16" />
              截图
            </UiButton>
            <UiButton
              variant="primary"
              size="sm"
              title="插入当前时间戳（⌥T）"
              :disabled="!player.state.ready"
              @click="insertTimestamp"
            >
              <AppIcon name="clock" :size="16" />
              插入时间戳
            </UiButton>
          </template>
        </LazyNoteEditor>

        <TranscriptPanel
          v-if="video"
          v-show="rightTab === 'transcript'"
          :key="`t:${course.id}:${video.path}`"
          :video="video"
          :course-id="course.id"
          :active="rightPanelOpen && rightTab === 'transcript'"
          :ai-settings="guide.state.settings"
          :ai-configured="guide.configured.value"
          @quote="quoteToNote"
          @toast="showToast"
        />
      </div>
    </div>
    <button
      v-if="!treeVisible"
      type="button"
      class="sidebar-edge-toggle sidebar-edge-left"
      title="展开左侧目录"
      aria-label="展开左侧目录"
      :aria-expanded="false"
      aria-controls="player-course-directory"
      @click="toggleTree"
    >
      <span class="sidebar-edge-icon"><AppIcon name="chevron-right" :size="12" /></span>
    </button>
    <button
      v-if="!rightPanelOpen"
      type="button"
      class="sidebar-edge-toggle sidebar-edge-right"
      title="展开右侧面板"
      aria-label="展开右侧面板"
      :aria-expanded="false"
      aria-controls="player-learning-panel"
      @click="rightPanelOpen = true"
    >
      <span class="sidebar-edge-icon"><AppIcon name="chevron-right" :size="12" class="rotate-180" /></span>
    </button>
  </main>
</template>

<style scoped>
.sidebar-toggle {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--color-stone);
}
.sidebar-toggle:hover {
  background: var(--color-cream-deep);
  color: var(--color-charcoal-ink);
}
.sidebar-toggle:focus-visible {
  outline: 2px solid var(--color-deep-indigo);
  outline-offset: 2px;
}
.sidebar-edge-toggle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 10;
  display: inline-flex;
  /* 整条页面边缘都能触发，宽度限制在 1rem 留白内，不遮挡视频。 */
  width: 1rem;
  align-items: center;
  border: 0;
  padding: 0;
  background: transparent;
}
.sidebar-edge-icon {
  display: inline-flex;
  width: 14px;
  max-width: 100%;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-linen);
  background: var(--color-pure-white);
  color: var(--color-stone);
  opacity: 0;
  transition: opacity 120ms ease;
}
.sidebar-edge-toggle:hover .sidebar-edge-icon,
.sidebar-edge-toggle:focus-visible .sidebar-edge-icon {
  opacity: 1;
}
.sidebar-edge-toggle:focus-visible {
  outline: none;
}
.sidebar-edge-toggle:focus-visible .sidebar-edge-icon {
  outline: 2px solid var(--color-deep-indigo);
  outline-offset: -2px;
}
.sidebar-edge-left {
  left: 0;
  justify-content: flex-start;
}
.sidebar-edge-right {
  right: 0;
  justify-content: flex-end;
}
.sidebar-edge-left .sidebar-edge-icon {
  border-left: 0;
  border-radius: 0 7px 7px 0;
}
.sidebar-edge-right .sidebar-edge-icon {
  border-right: 0;
  border-radius: 7px 0 0 7px;
}
@media (min-width: 1024px) {
  .player-layout {
    --directory-width: 280px;
    --learning-panel-width: 400px;
    grid-template-columns: var(--directory-width) minmax(0, 1fr) var(--learning-panel-width);
    grid-template-rows: minmax(0, 1fr);
  }
  .player-layout.directory-collapsed {
    grid-template-columns: minmax(0, 1fr) var(--learning-panel-width);
  }
  .player-layout.right-panel-collapsed {
    grid-template-columns: var(--directory-width) minmax(0, 1fr);
  }
  .player-layout.directory-collapsed.right-panel-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (min-width: 1280px) {
  .player-layout {
    --directory-width: 300px;
    --learning-panel-width: 440px;
  }
}
</style>

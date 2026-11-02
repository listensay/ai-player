<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { usePlayerPanels } from '~/composables/usePlayerPanels'
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import { usePageTitle } from '~/composables/usePageTitle'
import { formatTime } from '~/utils/time'
import AppIcon from '~/components/AppIcon.vue'
import CourseTree from '~/components/CourseTree.vue'
import AffineWorkspace from '~/components/AffineWorkspace.vue'
import TranscriptPanel from '~/components/TranscriptPanel.vue'
import LessonKnowledgePanel from '~/components/LessonKnowledgePanel.vue'
import UiButton from '~/components/UiButton.vue'
import VideoStage from '~/components/VideoStage.vue'
const LearningAssistantPanel = defineAsyncComponent(() => import('~/components/LearningAssistantPanel.vue'))
const {
  assistant,
  player,
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
  hasPrev,
  hasNext,
  onVideoSample,
  navigateEpisode,
  openGuide,
  openPractice,
  practiceSegment,
  completeSegment,
  noteAfterSegment,
  selectVideo,
  startSegment,
  showToast,
} = useCourseWorkspace()
function bindStage(instance: unknown) {
  stage.value = instance as typeof stage.value
}
const layout = ref<HTMLElement | null>(null)
const directory = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const panels = usePlayerPanels(layout, directory, panel, desktopTreeOpen, rightPanelOpen)
usePageTitle(() => `${video.value?.title ?? '播放器'} · Study Helper`)
</script>

<template>
  <main v-if="course" class="relative flex min-h-0 flex-1 overflow-hidden">
    <div
      ref="layout"
      class="player-layout scroll-soft grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:overflow-hidden"
      :style="panels.style.value"
      :class="{
        'directory-collapsed': !desktopTreeOpen,
        'right-panel-collapsed': !rightPanelOpen,
        'panels-dragging': panels.dragging.value,
      }"
    >
      <!-- 目录：大屏可收起侧栏，小屏作为抽屉；隐藏时保留筛选状态。 -->
      <div
        id="player-course-directory"
        ref="directory"
        class="min-h-0 min-w-0 lg:relative"
        :class="[
          treeOpen ? 'fixed inset-x-4 top-[72px] bottom-4 z-30' : 'max-lg:hidden',
          desktopTreeOpen ? 'lg:flex lg:flex-col' : 'lg:hidden',
        ]"
      >
        <button
          type="button"
          class="player-panel-resizer player-panel-resizer-left max-lg:hidden"
          role="separator"
          aria-label="调整目录宽度"
          aria-controls="player-course-directory"
          aria-orientation="vertical"
          :aria-valuenow="panels.directory.width.value"
          :aria-valuemin="0"
          :aria-valuemax="panels.directory.maxWidth.value"
          @pointerdown="panels.directory.start"
          @keydown="panels.directory.keydown"
        />
        <CourseTree
          :course="course"
          :current-path="video?.path ?? null"
          class="h-full overflow-hidden"
          @select="selectVideo"
          @guide="openGuide()"
          @start-today="startSegment"
        />
      </div>
      <div
        v-if="treeOpen"
        class="fixed inset-0 z-20 bg-charcoal-ink/30 lg:hidden"
        aria-hidden="true"
        @click="treeOpen = false"
      />

      <!-- 舞台 + 控制条 -->
      <div class="flex min-h-[60dvh] min-w-0 flex-col lg:min-h-0">
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
      </div>

      <!-- 笔记 / 逐字稿 -->
      <div
        v-show="rightPanelOpen"
        id="player-learning-panel"
        ref="panel"
        class="relative flex min-h-[60dvh] min-w-0 flex-col lg:min-h-0"
      >
        <button
          type="button"
          class="player-panel-resizer player-panel-resizer-right max-lg:hidden"
          role="separator"
          aria-label="调整笔记面板宽度"
          aria-controls="player-learning-panel"
          aria-orientation="vertical"
          :aria-valuenow="panels.learning.width.value"
          :aria-valuemin="0"
          :aria-valuemax="panels.learning.maxWidth.value"
          @pointerdown="panels.learning.start"
          @keydown="panels.learning.keydown"
        />
        <div class="pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
              <button
                type="button"
                role="tab"
                :aria-selected="rightTab === 'assistant'"
                class="inline-flex h-8 items-center rounded-full px-3 text-body-sm font-bold"
                :class="
                  rightTab === 'assistant' ? 'bg-sunbeam-yellow text-charcoal-ink' : 'text-graphite hover:bg-cream-deep'
                "
                title="打开 AI助教（⌥A）"
                @click="assistant.open()"
              >
                AI助教
              </button>
            </div>
          </div>

          <LearningAssistantPanel
            v-if="video && rightTab === 'assistant'"
            :key="`assistant:${course.id}:${video.path}`"
          />
          <LessonKnowledgePanel v-if="video" v-show="rightTab === 'knowledge'" />
          <AffineWorkspace
            v-if="video"
            v-show="rightTab === 'notes'"
            :course-id="course.id"
            :path="video.path"
            :title="video.title"
            :active="rightPanelOpen && rightTab === 'notes'"
            :blocked="player.state.fullscreen || treeOpen || !!panels.dragging.value"
          />

          <TranscriptPanel
            v-if="video"
            v-show="rightTab === 'transcript'"
            :key="`t:${course.id}:${video.path}`"
            :video="video"
            :course-id="course.id"
            :active="rightPanelOpen && rightTab === 'transcript'"
            :ai-settings="guide.state.settings"
            :ai-configured="guide.configured.value"
            @toast="showToast"
          />
        </div>
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
.sidebar-edge-toggle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 10;
  display: inline-flex;
  width: 8px;
  align-items: center;
  border: 0;
  padding: 0;
  background: transparent;
}
.sidebar-edge-icon {
  display: inline-flex;
  width: 14px;
  flex-shrink: 0;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-linen);
  background: var(--color-pure-white);
  color: var(--color-stone);
  opacity: 0;
  pointer-events: none;
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
.player-panel-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 16px;
  cursor: col-resize;
  touch-action: none;
  z-index: 10;
}
.player-panel-resizer-left {
  right: -16px;
}
.player-panel-resizer-right {
  left: -16px;
}
.player-panel-resizer::after {
  position: absolute;
  inset: 0 7px;
  border-radius: 1px;
  background: var(--color-linen);
  content: '';
  opacity: 0;
}
.player-panel-resizer:hover::after,
.player-panel-resizer:focus-visible::after {
  opacity: 1;
}
.player-panel-resizer:focus-visible {
  outline: 2px solid var(--color-deep-indigo);
  outline-offset: -2px;
}
.panels-dragging {
  cursor: col-resize;
  user-select: none;
}
@media (hover: none), (pointer: coarse) {
  .sidebar-edge-toggle {
    width: 32px;
  }
  .sidebar-edge-icon {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sidebar-edge-icon {
    transition: none;
  }
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

<script setup lang="ts">

import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import { usePageTitle } from '~/composables/usePageTitle'
import { formatTime } from '~/utils/time'
import AppIcon from '~/components/AppIcon.vue'
import CourseTree from '~/components/CourseTree.vue'
import NoteEditor from '~/components/NoteEditor.vue'
import TranscriptPanel from '~/components/TranscriptPanel.vue'
import LessonKnowledgePanel from '~/components/LessonKnowledgePanel.vue'
import DailyPracticeCard from '~/components/DailyPracticeCard.vue'
import UiButton from '~/components/UiButton.vue'
import VideoStage from '~/components/VideoStage.vue'
import { formatStudyClock, formatStudyHours } from '~/utils/checkIn'
const {
  player, noteEditor, stage, returnPoint, feedbackQuestionId, treeOpen, rightTab,
  transcripts, course, video, guide, segment, checkIn, hasPrev, hasNext,
  onVideoSample, navigateEpisode, recordQuestion, openGuide, openPractice,
  practiceSegment, completeSegment, noteAfterSegment, questionsAfterSegment,
  selectGuideVideo, returnToLesson, answerQuestion, selectVideo, insertTimestamp,
  screenshot, seekTo, quoteToNote, showToast,
} = useCourseWorkspace()
function bindStage(instance: unknown) { stage.value = instance as typeof stage.value }
function bindNoteEditor(instance: unknown) { noteEditor.value = instance as typeof noteEditor.value }
usePageTitle(() => `${video.value?.title ?? '播放器'} · AI Player`)
</script>

<template>
    <main
      v-if="course"
      class="scroll-soft relative grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[280px_minmax(0,1fr)_400px] lg:overflow-hidden xl:grid-cols-[300px_minmax(0,1fr)_440px]"
    >
      <!-- 目录：大屏常驻，小屏作为抽屉（fixed，不随主区域滚动） -->
      <div
        class="min-h-0 lg:contents"
        :class="treeOpen ? 'fixed inset-x-4 top-[72px] bottom-4 z-30 lg:static' : 'hidden lg:contents'"
      >
        <CourseTree
          :course="course"
          :current-path="video?.path ?? null"
          class="h-full lg:h-auto"
          @select="selectVideo"
          @guide="openGuide()"
          @start="selectGuideVideo($event)"
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
        <button type="button" class="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-linen bg-pure-white p-3 text-left transition-colors hover:border-charcoal-ink/30" @click="openGuide(undefined, 'today')">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-body-sm font-bold">今日学习</span>
              <span v-if="checkIn.isAchieved.value" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-caption font-bold text-emerald-800">
                <AppIcon name="check" :size="12" /> 今日已打卡
              </span>
              <span v-else class="text-caption font-bold text-stone">
                打卡进度 {{ checkIn.percent.value }}%
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-caption text-stone">
              <span>{{ guide.state.today?.items.filter(i => i.done).length ?? 0 }}/{{ guide.state.today?.items.length ?? 0 }} 项完成</span>
              <span>·</span>
              <span>已学 {{ formatStudyClock(checkIn.seconds.value) }} / 目标 {{ formatStudyHours(checkIn.targetSeconds.value) }}</span>
              <span v-if="checkIn.streak.value > 0" class="font-medium text-deep-indigo">· 连续打卡 {{ checkIn.streak.value }} 天</span>
            </div>
          </div>
          <span class="shrink-0 text-caption font-bold text-charcoal-ink">查看学习计划 →</span>
        </button>
        <DailyPracticeCard class="mb-3 shrink-0" />
        <div v-if="returnPoint" class="mb-3 flex items-center justify-between gap-3 rounded-xl border border-linen bg-sunbeam-yellow/15 p-3 text-body-sm">
          <span class="min-w-0 truncate">基础课回溯</span>
          <UiButton variant="ghost" size="sm" @click="returnToLesson">返回提问位置 {{ formatTime(returnPoint.seconds, true) }}</UiButton>
        </div>
        <div v-if="feedbackQuestionId" class="mb-3 shrink-0 rounded-xl border border-linen bg-page-cream p-3" aria-label="回看反馈">
          <p class="text-body-sm font-bold">疑问是否已解决</p>
          <p class="mt-1 truncate text-caption text-stone">{{ guide.state.questions.find(q => q.id === feedbackQuestionId)?.text }}</p>
          <div class="mt-2 flex flex-wrap gap-2"><UiButton size="sm" :disabled="!!guide.state.busy" @click="answerQuestion(true)">标记已解决</UiButton><UiButton size="sm" :disabled="!!guide.state.busy" @click="answerQuestion(false)">仍不理解</UiButton><UiButton variant="text" size="sm" @click="feedbackQuestionId = ''">稍后反馈</UiButton></div>
        </div>
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
            <section v-if="segment.reminder.value" role="status" aria-label="学习片段结束提醒" class="shrink-0 rounded-2xl border border-linen p-4 text-charcoal-ink" :class="player.state.fullscreen ? 'bg-page-cream' : 'bg-sunbeam-yellow/20'">
              <p class="text-body-sm font-bold">本次学习片段已结束</p>
              <p class="mt-1 text-caption text-stone">结束时间 {{ formatTime(segment.reminder.value.end, true) }}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <UiButton size="sm" @click="practiceSegment">开始练习</UiButton>
                <UiButton variant="ghost" size="sm" @click="noteAfterSegment">记录笔记</UiButton>
                <UiButton variant="ghost" size="sm" @click="questionsAfterSegment">处理疑问</UiButton>
                <UiButton variant="ghost" size="sm" @click="completeSegment">标记片段完成</UiButton>
                <UiButton variant="text" size="sm" @click="segment.dismiss()">收起提醒</UiButton>
              </div>
            </section>
          </template>
        </VideoStage>
        <div v-if="video" class="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <p v-if="segment.active.value" class="text-caption text-stone">本次片段 {{ formatTime(segment.active.value.start, true) }}–{{ formatTime(player.state.duration > 0 ? Math.min(segment.active.value.end, player.state.duration) : segment.active.value.end, true) }}</p>
          <UiButton variant="ghost" size="sm" class="ml-auto" @click="openPractice()">课后练习</UiButton>
        </div>
      </div>

      <!-- 笔记 / 逐字稿 -->
      <div class="pane flex min-h-[60dvh] min-w-0 flex-col lg:min-h-0">
        <div v-if="video" class="flex shrink-0 items-center gap-1 border-b border-linen px-3 pt-3 pb-2" role="tablist" aria-label="右侧面板">
          <button type="button" role="tab" :aria-selected="rightTab === 'knowledge'"
            class="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-body-sm font-bold transition-colors"
            :class="rightTab === 'knowledge' ? 'bg-sunbeam-yellow text-charcoal-ink' : 'text-graphite hover:bg-cream-deep'"
            @click="rightTab = 'knowledge'">知识点</button>
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
            :aria-selected="rightTab === 'transcript'"
            class="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-body-sm font-bold transition-colors duration-100 ease-soft"
            :class="rightTab === 'transcript' ? 'bg-charcoal-ink text-pure-white' : 'text-graphite hover:bg-cream-deep'"
            @click="rightTab = 'transcript'"
          >
            逐字稿
            <span
              v-if="transcripts.get(course.id, video.path).status === 'transcribing'"
              class="tabular rounded-full bg-sunbeam-yellow px-1.5 text-caption text-charcoal-ink"
              :title="'转写中'"
            >
              {{ transcripts.get(course.id, video.path).progress === null ? '…' : `${Math.round((transcripts.get(course.id, video.path).progress ?? 0) * 100)}%` }}
            </span>
            <span
              v-else-if="transcripts.get(course.id, video.path).status === 'ready'"
              class="h-1.5 w-1.5 rounded-full"
              :class="rightTab === 'transcript' ? 'bg-sunbeam-yellow' : 'bg-charcoal-ink'"
              aria-hidden="true"
            />
          </button>
        </div>

        <LessonKnowledgePanel v-if="video" v-show="rightTab === 'knowledge'" />
        <NoteEditor
          v-if="video"
          v-show="rightTab === 'notes'"
          :ref="bindNoteEditor"
          :key="`${course.id}:${video.path}`"
          :video="video"
          :course-id="course.id"
          class="flex-1 border-0"
          @seek="seekTo"
          @ask-guide="openGuide($event)"
          @record-question="recordQuestion"
        >
          <template #actions>
            <UiButton variant="dark" size="sm" title="截取当前画面到笔记（⌥S）" :disabled="!player.state.ready" @click="screenshot">
              <AppIcon name="camera" :size="16" />
              截图
            </UiButton>
            <UiButton variant="primary" size="sm" title="插入当前时间戳（⌥T）" :disabled="!player.state.ready" @click="insertTimestamp">
              <AppIcon name="clock" :size="16" />
              插入时间戳
            </UiButton>
          </template>
        </NoteEditor>

        <TranscriptPanel
          v-if="video"
          v-show="rightTab === 'transcript'"
          :key="`t:${course.id}:${video.path}`"
          :video="video"
          :course-id="course.id"
          :active="rightTab === 'transcript'"
          :ai-settings="guide.state.settings"
          :ai-configured="guide.configured.value"
          @quote="quoteToNote"
          @toast="showToast"
        />
      </div>
    </main>

</template>

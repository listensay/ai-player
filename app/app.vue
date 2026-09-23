<script setup lang="ts">
/**
 * 应用外壳：没有课程时显示欢迎页，有课程时显示三栏工作台（目录 / 舞台 / 笔记）。
 * 快捷键、截图、时间戳这些跨组件的动作都在这里串起来。
 */
import type { VideoEntry } from '~/types/course'
import type { TodayItem } from '~/types/guide'
import type { PracticeScope } from '~/types/practice'
import { formatStudyClock, formatStudyHours } from '~/utils/checkIn'

const store = useCourseStore()
const { stats } = store
const player = usePlayer()

const noteEditor = ref<{
  insertTimestamp: (seconds: number) => void
  insertScreenshot: (blob: Blob, seconds: number, ratio?: number) => Promise<void>
  setPlayhead: (seconds: number) => void
  save: () => Promise<void>
  focus: () => void
  getMarkdown: () => string | undefined
} | null>(null)
const stage = ref<{ toggleFullscreen: () => void } | null>(null)

const helpOpen = ref(false)
const guideOpen = ref(false)
const guideQuestion = ref<string | undefined>()
const guideTab = ref<'plan' | 'today' | 'help' | 'settings'>('plan')
const returnPoint = ref<{ path: string; seconds: number; questionId?: string } | null>(null)
const feedbackQuestionId = ref('')
const pendingSeek = ref<{ path: string; seconds: number } | null>(null)
const treeOpen = ref(false)
const currentView = ref<'dashboard' | 'player'>('dashboard')
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const course = computed(() => store.state.course)
const video = computed(() => store.state.currentVideo)
const guide = useLearningGuide(course)
const practice = useLessonPractice(course, guide.state.settings)
const segment = useSegmentReminder(computed(() => course.value?.id), computed(() => video.value?.path), computed(() => guide.state.today))
const checkInPlan = computed(() => ({
  today: guide.state.today,
  dailyMinutes: guide.state.plan?.dailyMinutes ?? (guide.state.today?.minutes ?? 120),
}))
const checkIn = useStudyCheckIn(course, checkInPlan)

watch(() => checkIn.justCheckedIn.value, (day) => {
  if (day) {
    const hours = Math.floor(day.targetSeconds / 3600)
    const minutes = Math.floor((day.targetSeconds % 3600) / 60)
    const timeStr = hours > 0 ? `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ''}` : `${minutes} 分钟`
    showToast(`🎉 恭喜！今日已有效学满规划的 ${timeStr}，打卡成功并在日历中打勾！`)
  }
})
const hasPrev = computed(() => !!video.value && !!guide.adjacent(video.value.path, -1))
const hasNext = computed(() => !!video.value && !!guide.adjacent(video.value.path, 1))

function onVideoSample(sample: import('~/types/practice').PlaybackSample) {
  segment.sample(sample)
  if (video.value) {
    checkIn.sample(video.value.path, sample)
  }
}

function navigateEpisode(offset: -1 | 1) {
  if (!video.value) return
  const next = guide.adjacent(video.value.path, offset)
  if (next) selectVideo(next)
}

function recordQuestion(question: string) {
  if (!video.value) return
  const entry = guide.saveQuestion(question, video.value.path, player.state.currentTime)
  showToast(entry ? '疑问已记录，可在导学清单中继续处理' : '先选中一段疑问，或在笔记中写下问题')
  return entry
}

function openGuide(question?: string, tab: 'plan' | 'today' | 'help' | 'settings' = 'plan') {
  if (question?.trim() && video.value) {
    const entry = guide.saveQuestion(question, video.value.path, player.state.currentTime)
    if (entry) guide.selectQuestion(entry.id)
  }
  guideQuestion.value = question
  guideTab.value = tab
  guideOpen.value = true
}

function startSegment(item: TodayItem) {
  currentView.value = 'player'
  selectGuideVideo(item.path, item.start)
  segment.start(item)
}

async function leaveFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
}

async function openPractice(scope: PracticeScope | null = null) {
  const target = video.value, courseId = course.value?.id
  if (!target) return
  const snapshot = noteEditor.value?.getMarkdown()
  player.pause()
  await leaveFullscreen()
  if (video.value?.path === target.path && course.value?.id === courseId) void practice.open(target, scope, snapshot)
}

function practiceSegment() {
  const reminder = segment.reminder.value
  if (!reminder) return
  const scope = { start: reminder.item.start, end: reminder.end }
  segment.dismiss()
  void openPractice(scope)
}

function completeSegment() {
  const item = segment.reminder.value?.item
  if (item) guide.completeTodayItem(item.id, true)
  segment.dismiss()
  showToast('本次片段已完成，掌握程度可在练习后单独标记')
}

async function noteAfterSegment() {
  const seconds = segment.reminder.value?.end
  player.pause(); segment.dismiss()
  await leaveFullscreen()
  if (seconds !== undefined) noteEditor.value?.insertTimestamp(seconds)
  noteEditor.value?.focus()
}

async function questionsAfterSegment() {
  player.pause(); segment.dismiss()
  await leaveFullscreen()
  openGuide(undefined, 'help')
}

function selectGuideVideo(path: string, seconds?: number, returning = false, questionId?: string) {
  currentView.value = 'player'
  const target = course.value?.videos.find(v => v.path === path)
  if (!target) return
  if (returning && video.value && (!returnPoint.value || (questionId && returnPoint.value.questionId !== questionId))) {
    const question = guide.state.questions.find(q => q.id === questionId)
    returnPoint.value = question ? { path: question.path, seconds: question.seconds, questionId }
      : { path: video.value.path, seconds: player.state.currentTime }
  }
  if (video.value?.path === path) {
    if (seconds !== undefined) seekTo(seconds)
  } else {
    selectVideo(target)
    if (seconds !== undefined) pendingSeek.value = { path, seconds }
  }
}

function returnToLesson() {
  const point = returnPoint.value
  if (!point) return
  selectGuideVideo(point.path, point.seconds)
  feedbackQuestionId.value = point.questionId ?? ''
  returnPoint.value = null
}

function answerQuestion(resolved: boolean) {
  guide.setQuestionStatus(feedbackQuestionId.value, resolved ? 'resolved' : 'still-confused')
  feedbackQuestionId.value = ''
  showToast(resolved ? '已记为解决，掌握程度可在知识地图中单独标记' : '已记录反馈，回看过的基础课已加入补学')
}

watch(() => player.state.ready, ready => {
  const target = pendingSeek.value
  if (ready && target && video.value?.path === target.path) {
    seekTo(target.seconds)
    pendingSeek.value = null
  }
})
watch(() => course.value?.id, (newId) => {
  if (newId) currentView.value = 'dashboard'
  guideOpen.value = false
  guideQuestion.value = undefined
  returnPoint.value = null
  pendingSeek.value = null
  feedbackQuestionId.value = ''
})

function playVideoFromDashboard(v: VideoEntry) {
  selectVideo(v)
  currentView.value = 'player'
}

function switchView(view: 'dashboard' | 'player') {
  currentView.value = view
}

function showToast(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2200)
}

function selectVideo(v: VideoEntry) {
  pendingSeek.value = null
  store.selectVideo(v)
  treeOpen.value = false
}

function insertTimestamp() {
  if (!noteEditor.value || !player.state.ready) return
  noteEditor.value.insertTimestamp(player.state.currentTime)
}

async function screenshot() {
  if (!noteEditor.value || !player.state.ready) return
  const frame = await player.captureFrame()
  if (!frame) {
    showToast('画面还没准备好，稍等一下再截图')
    return
  }
  try {
    await noteEditor.value.insertScreenshot(frame.blob, player.state.currentTime, frame.ratio)
    showToast(`已截图 ${formatTime(player.state.currentTime, true)}`)
  } catch (err) {
    console.error(err)
    showToast(`截图保存失败：${(err as Error).message}`)
  }
}

async function saveNote() {
  if (!noteEditor.value) return
  await noteEditor.value.save()
  showToast('笔记已保存')
}

function seekTo(seconds: number) {
  player.seek(seconds)
  if (!player.state.playing) void player.play()
}

useShortcuts({
  togglePlay: () => player.toggle(),
  seekBy: (s) => player.seekBy(s),
  volumeBy: (d) => player.setVolume(player.state.volume + d),
  toggleMute: () => player.toggleMute(),
  toggleFullscreen: () => stage.value?.toggleFullscreen(),
  rateStep: (dir) => player.stepRate(dir),
  insertTimestamp,
  screenshot: () => void screenshot(),
  saveNote: () => void saveNote(),
  prevEpisode: () => navigateEpisode(-1),
  nextEpisode: () => navigateEpisode(1),
  toggleHelp: () => (helpOpen.value = !helpOpen.value),
  closeOverlays: () => {
    helpOpen.value = false
    guideOpen.value = false
    practice.close()
    treeOpen.value = false
  },
})

// 播放头每走过 1 秒，同步一次到笔记，用于高亮所在片段的时间戳
watch(
  () => Math.floor(player.state.currentTime),
  (sec) => noteEditor.value?.setPlayhead(sec),
)
</script>

<template>
  <div class="flex h-dvh flex-col bg-page-cream text-charcoal-ink">
    <AppTopBar
      :course-name="course?.name"
      :total="stats.total"
      :done="stats.done"
      :current-view="currentView"
      :show-tree-toggle="!!course && currentView === 'player'"
      @help="helpOpen = true"
      @close="store.closeCourse()"
      @toggle-tree="treeOpen = !treeOpen"
      @guide="openGuide()"
      @switch-view="switchView"
    />

    <main v-if="!course" class="scroll-soft min-h-0 flex-1 overflow-y-auto">
      <WelcomeScreen />
    </main>

    <CourseDashboard
      v-else-if="currentView === 'dashboard'"
      :course="course"
      :stats="stats"
      :current-video="video"
      @play="playVideoFromDashboard"
      @guide="openGuide(undefined, $event ?? 'plan')"
    />

    <main
      v-else
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
              <span class="text-body-sm font-bold">今日学习与打卡</span>
              <span v-if="checkIn.isAchieved.value" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-caption font-bold text-emerald-800">
                <AppIcon name="check" :size="12" /> 今日打卡已达标
              </span>
              <span v-else class="text-caption font-bold text-stone">
                打卡进度 {{ checkIn.percent.value }}%
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-caption text-stone">
              <span>{{ guide.state.today?.items.filter(i => i.done).length ?? 0 }}/{{ guide.state.today?.items.length ?? 0 }} 项完成</span>
              <span>·</span>
              <span>已学 {{ formatStudyClock(checkIn.seconds.value) }} / 规划 {{ formatStudyHours(checkIn.targetSeconds.value) }}</span>
              <span v-if="checkIn.streak.value > 0" class="font-medium text-deep-indigo">· 连续打卡 {{ checkIn.streak.value }} 天</span>
            </div>
          </div>
          <span class="shrink-0 text-caption font-bold text-charcoal-ink">查看日历与安排 →</span>
        </button>
        <div v-if="returnPoint" class="mb-3 flex items-center justify-between gap-3 rounded-xl border border-linen bg-sunbeam-yellow/15 p-3 text-body-sm">
          <span class="min-w-0 truncate">正在补基础 · 随时回到刚才的学习位置</span>
          <UiButton variant="ghost" size="sm" @click="returnToLesson">返回原课 {{ formatTime(returnPoint.seconds, true) }}</UiButton>
        </div>
        <div v-if="feedbackQuestionId" class="mb-3 shrink-0 rounded-xl border border-linen bg-page-cream p-3" aria-label="回看反馈">
          <p class="text-body-sm font-bold">刚才的疑问解决了吗？</p>
          <p class="mt-1 truncate text-caption text-stone">{{ guide.state.questions.find(q => q.id === feedbackQuestionId)?.text }}</p>
          <div class="mt-2 flex flex-wrap gap-2"><UiButton size="sm" :disabled="!!guide.state.busy" @click="answerQuestion(true)">解决了</UiButton><UiButton size="sm" :disabled="!!guide.state.busy" @click="answerQuestion(false)">仍不理解</UiButton><UiButton variant="text" size="sm" @click="feedbackQuestionId = ''">稍后反馈</UiButton></div>
        </div>
        <VideoStage
          v-if="video"
          ref="stage"
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
              <p class="text-body-sm font-bold">这一段到这里，消化一下吧。</p>
              <p class="mt-1 text-caption text-stone">已到 {{ formatTime(segment.reminder.value.end, true) }} · 播放可继续，完成状态由你确认。</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <UiButton size="sm" @click="practiceSegment">检验一下</UiButton>
                <UiButton variant="ghost" size="sm" @click="noteAfterSegment">记笔记</UiButton>
                <UiButton variant="ghost" size="sm" @click="questionsAfterSegment">处理疑问</UiButton>
                <UiButton variant="ghost" size="sm" @click="completeSegment">标记片段完成</UiButton>
                <UiButton variant="text" size="sm" @click="segment.dismiss()">收起提醒</UiButton>
              </div>
            </section>
          </template>
        </VideoStage>
        <div v-if="video" class="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <p class="text-caption text-stone">{{ segment.active.value ? `本次片段 ${formatTime(segment.active.value.start, true)}–${formatTime(player.state.duration > 0 ? Math.min(segment.active.value.end, player.state.duration) : segment.active.value.end, true)} · 到点提醒` : '学过一段，试着用自己的话讲一遍。' }}</p>
          <UiButton variant="ghost" size="sm" @click="openPractice()">学完一小练</UiButton>
        </div>
      </div>

      <!-- 笔记 -->
      <div class="flex min-h-[60dvh] min-w-0 flex-col lg:min-h-0">
        <NoteEditor
          v-if="video"
          ref="noteEditor"
          :key="`${course.id}:${video.path}`"
          :video="video"
          :course-id="course.id"
          class="flex-1"
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
      </div>
    </main>

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
    <GuideDialog v-if="course" :key="course.id" :open="guideOpen" :current-video="video" :initial-question="guideQuestion" :initial-tab="guideTab"
      @close="guideOpen = false" @select="selectGuideVideo" @segment="startSegment" />
    <PracticeDialog v-if="course" :practice="practice" @settings="openGuide(undefined, 'settings')" @seek="selectGuideVideo" @help="openGuide($event, 'help')" />
  </div>
</template>

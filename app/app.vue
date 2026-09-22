<script setup lang="ts">
/**
 * 应用外壳：没有课程时显示欢迎页，有课程时显示三栏工作台（目录 / 舞台 / 笔记）。
 * 快捷键、截图、时间戳这些跨组件的动作都在这里串起来。
 */
import type { VideoEntry } from '~/types/course'

const store = useCourseStore()
const { stats } = store
const player = usePlayer()

const noteEditor = ref<{
  insertTimestamp: (seconds: number) => void
  insertScreenshot: (blob: Blob, seconds: number, ratio?: number) => Promise<void>
  setPlayhead: (seconds: number) => void
  save: () => Promise<void>
  focus: () => void
} | null>(null)
const stage = ref<{ toggleFullscreen: () => void } | null>(null)

const helpOpen = ref(false)
const treeOpen = ref(false)
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const course = computed(() => store.state.course)
const video = computed(() => store.state.currentVideo)
const hasPrev = computed(() => !!video.value && video.value.index > 0)
const hasNext = computed(
  () => !!video.value && !!course.value && video.value.index < course.value.videos.length - 1,
)

function showToast(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2200)
}

function selectVideo(v: VideoEntry) {
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
  prevEpisode: () => store.selectByOffset(-1),
  nextEpisode: () => store.selectByOffset(1),
  toggleHelp: () => (helpOpen.value = !helpOpen.value),
  closeOverlays: () => {
    helpOpen.value = false
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
      :show-tree-toggle="!!course"
      @help="helpOpen = true"
      @close="store.closeCourse()"
      @toggle-tree="treeOpen = !treeOpen"
    />

    <main v-if="!course" class="scroll-soft min-h-0 flex-1 overflow-y-auto">
      <WelcomeScreen />
    </main>

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
          ref="stage"
          :key="video.path"
          :video="video"
          :course-id="course.id"
          :has-prev="hasPrev"
          :has-next="hasNext"
          @prev="store.selectByOffset(-1)"
          @next="store.selectByOffset(1)"
        />
      </div>

      <!-- 笔记 -->
      <div class="flex min-h-[60dvh] min-w-0 flex-col lg:min-h-0">
        <NoteEditor
          v-if="video"
          ref="noteEditor"
          :key="video.path"
          :video="video"
          :course-id="course.id"
          class="flex-1"
          @seek="seekTo"
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
  </div>
</template>

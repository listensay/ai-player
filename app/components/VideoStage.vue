<script setup lang="ts">
import type { VideoEntry } from '~/types/course'
import type { PlaybackSample } from '~/types/practice'

const props = defineProps<{
  video: VideoEntry
  courseId: string
  hasPrev: boolean
  hasNext: boolean
}>()

const emit = defineEmits<{
  prev: []
  next: []
  sample: [sample: PlaybackSample]
  practice: []
}>()

const player = usePlayer()
const progress = useProgress()
const { state } = player

const wrapperEl = ref<HTMLElement>()
const videoEl = ref<HTMLVideoElement>()

const loading = ref(true)
const ended = ref(false)
let objectUrl: string | null = null
let lastPersist = 0
/** 卸载中：忽略 <video> 在被移除时补发的 pause/timeupdate 事件 */
let unmounting = false

/** 拖动进度条时用本地值，避免被 timeupdate 拉回去 */
const scrubbing = ref(false)
const scrubValue = ref(0)

const seekValue = computed(() => (scrubbing.value ? scrubValue.value : state.currentTime))
const seekFill = computed(() =>
  state.duration > 0 ? `${Math.min(100, (seekValue.value / state.duration) * 100)}%` : '0%',
)
const volumeFill = computed(() => `${(state.muted ? 0 : state.volume) * 100}%`)

const savedProgress = computed(() => progress.get(props.courseId, props.video.path))

const resumeHint = computed(() => {
  const p = savedProgress.value
  if (!p) return ''
  if (p.done) return '已看完'
  if (p.ratio > 0) return `上次看到 ${formatTime(p.time)}`
  return ''
})

function persistProgress(force = false, opts: { ended?: boolean } = {}) {
  const v = videoEl.value
  if (!v || !state.ready) return
  const now = Date.now()
  if (!force && now - lastPersist < 3000) return
  lastPersist = now
  progress.update(props.courseId, props.video.path, v.currentTime, v.duration, opts)
}

async function loadSource() {
  const v = videoEl.value
  if (!v) return
  loading.value = true
  ended.value = false
  state.error = ''
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  try {
    const file = await props.video.handle.getFile()
    objectUrl = URL.createObjectURL(file)
    v.src = objectUrl
    v.load()
  } catch (err) {
    loading.value = false
    state.error = `读取视频文件失败：${(err as Error).message}`
  }
}

/** 事件里的 <video>；组件卸载过程中 ref 可能已被清空，但事件仍会触发，所以从事件对象取 */
function videoFrom(e: Event): HTMLVideoElement | null {
  const el = (e.currentTarget ?? e.target) as HTMLVideoElement | null
  return el && el.tagName === 'VIDEO' ? el : null
}

function onLoadedMetadata(e: Event) {
  const v = videoFrom(e)
  if (!v || unmounting) return
  player.sync.loadedMetadata(v)
  loading.value = false
  // 回到上次看到的位置；已看完的从头开始
  const p = savedProgress.value
  if (p && !p.done && p.time > 1 && p.time < v.duration - 3) v.currentTime = p.time
}

function onTimeUpdate(e: Event) {
  const v = videoFrom(e)
  if (!v || unmounting) return
  player.sync.timeUpdate(v)
  persistProgress()
  onSample(e)
}

function onSample(e: Event) {
  const v = videoFrom(e)
  if (!v || unmounting) return
  emit('sample', { seconds: v.currentTime, duration: v.duration, seeking: v.seeking || e.type === 'seeking',
    playing: !v.paused, ended: v.ended, rate: v.playbackRate, at: performance.now() })
}

function onEnded(e: Event) {
  if (unmounting) return
  ended.value = true
  state.playing = false
  persistProgress(true, { ended: true })
  onSample(e)
}

function onPause(e: Event) {
  if (unmounting) return
  player.sync.pause()
  persistProgress(true)
  onSample(e)
}

function onVideoEvent(e: Event, handler: (v: HTMLVideoElement) => void) {
  const v = videoFrom(e)
  if (!v || unmounting) return
  handler(v)
}

function onSeekInput(e: Event) {
  const value = Number((e.target as HTMLInputElement).value)
  scrubbing.value = true
  scrubValue.value = value
}

function onSeekChange(e: Event) {
  const value = Number((e.target as HTMLInputElement).value)
  scrubbing.value = false
  player.seek(value)
  ended.value = false
}

function onVolumeInput(e: Event) {
  player.setVolume(Number((e.target as HTMLInputElement).value))
}

function onStageClick() {
  if (state.error) return
  ended.value = false
  player.toggle()
}

function onFullscreenChange() {
  player.sync.fullscreenChange()
}

function toggleFullscreen() {
  void player.toggleFullscreen(wrapperEl.value ?? null)
}

function onBeforeUnload() {
  persistProgress(true)
  progress.flush()
}

onMounted(() => {
  const v = videoEl.value!
  player.attach(v)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  window.addEventListener('beforeunload', onBeforeUnload)
  void loadSource()
})

watch(
  () => props.video.path,
  () => {
    persistProgress(true)
    state.ready = false
    state.currentTime = 0
    state.duration = 0
    void loadSource()
  },
)

onBeforeUnmount(() => {
  unmounting = true
  persistProgress(true)
  progress.flush()
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  window.removeEventListener('beforeunload', onBeforeUnload)
  player.detach()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})

defineExpose({ toggleFullscreen })
</script>

<template>
  <div
    ref="wrapperEl"
    class="flex min-h-0 flex-1 flex-col gap-4"
    :class="state.fullscreen ? 'bg-soft-black p-4' : ''"
  >
    <!-- 舞台：奶油桌面上唯一的深色物件，24px 圆角 + 2px 偏移阴影 -->
    <div
      class="relative min-h-0 flex-1 overflow-hidden rounded-3xl bg-charcoal-ink shadow-subtle"
      @click="onStageClick"
      @dblclick="toggleFullscreen"
    >
      <video
        ref="videoEl"
        class="h-full w-full object-contain"
        playsinline
        preload="metadata"
        tabindex="-1"
        @loadedmetadata="onLoadedMetadata"
        @durationchange="onVideoEvent($event, player.sync.durationChange)"
        @timeupdate="onTimeUpdate"
        @play="player.sync.play()"
        @playing="player.sync.playing(); onSample($event)"
        @seeking="onSample"
        @seeked="onSample"
        @pause="onPause"
        @waiting="player.sync.waiting()"
        @ended="onEnded"
        @ratechange="onVideoEvent($event, player.sync.rateChange)"
        @volumechange="onVideoEvent($event, player.sync.volumeChange)"
        @error="onVideoEvent($event, player.sync.error)"
      />

      <!-- 读取中 -->
      <div
        v-if="loading && !state.error"
        class="absolute inset-0 flex items-center justify-center text-body-sm font-medium text-linen"
      >
        正在读取视频…
      </div>

      <!-- 出错 -->
      <div
        v-else-if="state.error"
        class="absolute inset-0 flex items-center justify-center p-8"
        @click.stop
      >
        <div class="max-w-md rounded-2xl bg-pure-white p-6 text-center">
          <p class="text-body font-bold text-charcoal-ink">这一集播不了</p>
          <p class="mt-2 text-body-sm text-graphite">{{ state.error }}</p>
        </div>
      </div>

      <!-- 播放结束：提示下一集 -->
      <div
        v-else-if="ended"
        class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-charcoal-ink/70"
        @click.stop
      >
        <p class="text-subheading font-bold text-pure-white">这一集看完了</p>
        <div class="flex flex-wrap justify-center gap-3">
          <UiButton @click="emit('practice')">学完一小练</UiButton>
          <UiButton variant="ghost" @click="onStageClick">再看一遍</UiButton>
          <UiButton v-if="hasNext" variant="dark" @click="emit('next')">
            播放下一集
            <AppIcon name="skip-next" :size="18" />
          </UiButton>
        </div>
      </div>

      <!-- 暂停时的大播放按钮：黄色 = 此刻 -->
      <button
        v-else-if="state.ready && !state.playing"
        type="button"
        class="absolute top-1/2 left-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-sunbeam-yellow text-charcoal-ink shadow-subtle transition-transform duration-150 ease-soft hover:scale-105"
        aria-label="播放"
        @click.stop="onStageClick"
      >
        <AppIcon name="play" :size="36" class="ml-1" />
      </button>

      <!-- 缓冲提示 -->
      <div
        v-if="state.playing && state.buffering"
        class="absolute top-4 right-4 rounded-full bg-charcoal-ink/80 px-3 py-1 text-caption font-medium text-linen"
      >
        缓冲中…
      </div>
    </div>

    <slot name="reminder" />

    <!-- 控制条：白色纸面 -->
    <div class="pane shrink-0 px-4 py-3" :class="state.fullscreen ? 'border-transparent' : ''">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-charcoal-ink text-pure-white shadow-subtle transition-colors hover:bg-soft-black active:translate-y-px active:shadow-none disabled:opacity-40"
          :aria-label="state.playing ? '暂停' : '播放'"
          :disabled="!state.ready"
          @click="onStageClick"
        >
          <AppIcon :name="state.playing ? 'pause' : 'play'" :size="22" :class="state.playing ? '' : 'ml-0.5'" />
        </button>

        <UiButton variant="text" size="sm" icon title="后退 5 秒（←）" :disabled="!state.ready" @click="player.seekBy(-5)">
          <AppIcon name="rewind" :size="18" />
        </UiButton>
        <UiButton variant="text" size="sm" icon title="前进 5 秒（→）" :disabled="!state.ready" @click="player.seekBy(5)">
          <AppIcon name="forward" :size="18" />
        </UiButton>

        <span class="tabular ml-1 w-14 shrink-0 text-right text-body-sm font-medium text-charcoal-ink">
          {{ formatTime(seekValue) }}
        </span>

        <label class="flex min-w-0 flex-1 items-center px-1">
          <span class="sr-only">播放进度</span>
          <input
            type="range"
            class="range-soft"
            min="0"
            :max="state.duration || 0"
            step="0.1"
            :value="seekValue"
            :disabled="!state.ready"
            :style="{ '--range-fill': seekFill }"
            @input="onSeekInput"
            @change="onSeekChange"
          />
        </label>

        <span class="tabular w-14 shrink-0 text-body-sm font-medium text-stone">
          {{ formatTime(state.duration) }}
        </span>

        <PlaybackRateMenu :rate="state.rate" @change="player.setRate" />

        <div class="ml-1 hidden items-center gap-1 md:flex">
          <UiButton
            variant="text"
            size="sm"
            icon
            :title="state.muted ? '取消静音（M）' : '静音（M）'"
            @click="player.toggleMute()"
          >
            <AppIcon :name="state.muted || state.volume === 0 ? 'volume-mute' : 'volume'" :size="18" />
          </UiButton>
          <label class="flex w-20 items-center">
            <span class="sr-only">音量</span>
            <input
              type="range"
              class="range-soft"
              min="0"
              max="1"
              step="0.05"
              :value="state.muted ? 0 : state.volume"
              :style="{ '--range-fill': volumeFill }"
              @input="onVolumeInput"
            />
          </label>
        </div>

        <UiButton
          variant="text"
          size="sm"
          icon
          :title="state.fullscreen ? '退出全屏（F）' : '全屏（F）'"
          @click="toggleFullscreen"
        >
          <AppIcon :name="state.fullscreen ? 'fullscreen-exit' : 'fullscreen'" :size="18" />
        </UiButton>
      </div>

      <div class="mt-2 flex items-center gap-3 border-t border-linen pt-2">
        <h1 class="min-w-0 flex-1 truncate text-body font-bold" :title="video.path">
          {{ video.title }}
        </h1>
        <span v-if="resumeHint" class="tabular shrink-0 text-caption text-stone">{{ resumeHint }}</span>
        <div class="flex shrink-0 items-center gap-1">
          <UiButton variant="text" size="sm" icon title="上一集（Shift+P）" :disabled="!hasPrev" @click="emit('prev')">
            <AppIcon name="skip-prev" :size="18" />
          </UiButton>
          <UiButton variant="text" size="sm" icon title="下一集（Shift+N）" :disabled="!hasNext" @click="emit('next')">
            <AppIcon name="skip-next" :size="18" />
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

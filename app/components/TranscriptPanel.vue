<script setup lang="ts">
import { onBeforeUnmount, computed, ref, watch, nextTick } from 'vue'
import { usePlayer } from '~/composables/usePlayer'
import { useTranscripts } from '~/composables/useTranscripts'
import { formatTime, timestampToken } from '~/utils/time'
import { activeSegmentIndex, searchTranscript, splitByRanges } from '~/utils/transcript'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
/**
 * 逐字稿面板：
 *  - 没有字幕 → 引导启动本机服务 / 一键转写（进度与句子实时出现）
 *  - 有字幕   → 句子列表，点击跳转；播放头所在句高亮并自动跟随；全文检索高亮命中
 * 组件常驻（v-show 切换页签），转写任务本身放在 useTranscripts 里，切课也不会中断。
 */
import type { VideoEntry } from '~/types/course'

const props = defineProps<{
  video: VideoEntry
  courseId: string
  /** 面板当前是否可见（可见时才探测服务、自动滚动） */
  active: boolean
}>()

const emit = defineEmits<{
  quote: [text: string]
}>()

const transcripts = useTranscripts()
const asr = transcripts.asr
const player = usePlayer()

const state = computed(() => transcripts.get(props.courseId, props.video.path))
const query = ref('')
const listEl = ref<HTMLElement>()
const follow = ref(true)
const matchCursor = ref(0)

const matches = computed(() => searchTranscript(state.value.segments, query.value))
const matchMap = computed(() => new Map(matches.value.map((m) => [m.segmentId, m.ranges])))
const activeIndex = computed(() => activeSegmentIndex(state.value.segments, player.state.currentTime))

const serviceHint = computed(() => {
  const s = asr.state
  if (s.status === 'offline') return '本机转写已停止'
  if (s.status === 'error') return `服务异常：${s.lastError}`
  if (s.status === 'preparing') {
    const d = s.health?.download
    if (d && d.total) return `正在下载模型 ${Math.round((d.received / d.total) * 100)}%（${(d.total / 1048576).toFixed(0)} MB）`
    if (s.health?.status === 'downloading') return '正在下载模型…'
    return '正在加载模型…'
  }
  return ''
})

const progressText = computed(() => {
  const s = state.value
  if (s.status !== 'transcribing') return ''
  if (s.progress !== null) return `${Math.round(s.progress * 100)}%`
  return `已处理 ${formatTime(s.processedSeconds)}`
})

const estimate = computed(() => {
  const d = player.state.duration
  if (!d) return ''
  // SenseVoice 在 Apple Silicon 上大约 30–60 倍实时
  const secs = Math.max(5, Math.round(d / 40))
  return secs < 60 ? `约 ${secs} 秒` : `约 ${Math.ceil(secs / 60)} 分钟`
})

function seek(seconds: number) {
  player.seek(seconds)
  if (!player.state.playing) void player.play()
}

function startTranscribe() {
  void transcripts.transcribe(props.courseId, props.video, player.state.duration)
}

function retranscribe() {
  transcripts.reset(props.courseId, props.video.path)
  startTranscribe()
}

function quote(seg: { start: number; text: string }) {
  emit('quote', `${timestampToken(seg.start)} ${seg.text}`)
}

function scrollToIndex(index: number, smooth = true) {
  const el = listEl.value?.querySelector<HTMLElement>(`[data-index="${index}"]`)
  el?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' })
}

function jumpMatch(dir: 1 | -1) {
  const list = matches.value
  if (!list.length) return
  matchCursor.value = (matchCursor.value + dir + list.length) % list.length
  const seg = state.value.segments.find((s) => s.id === list[matchCursor.value]!.segmentId)
  if (seg) {
    follow.value = false
    scrollToIndex(state.value.segments.indexOf(seg))
  }
}

function onScroll() {
  // 用户手动滚动时暂停跟随；点“定位当前句”恢复
  if (!scrollingByCode) follow.value = false
}
let scrollingByCode = false
let scrollTimer: ReturnType<typeof setTimeout> | null = null
function programmaticScroll(index: number) {
  scrollingByCode = true
  scrollToIndex(index)
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => (scrollingByCode = false), 600)
}

function resumeFollow() {
  follow.value = true
  query.value = ''
  if (activeIndex.value >= 0) programmaticScroll(activeIndex.value)
}

watch(activeIndex, (i) => {
  if (props.active && follow.value && !query.value && i >= 0) programmaticScroll(i)
})

watch(matches, () => {
  matchCursor.value = 0
  if (matches.value.length) {
    const seg = state.value.segments.find((s) => s.id === matches.value[0]!.segmentId)
    if (seg) {
      follow.value = false
      nextTick(() => scrollToIndex(state.value.segments.indexOf(seg), false))
    }
  }
})

watch(
  () => [props.courseId, props.video.path] as const,
  () => {
    query.value = ''
    follow.value = true
    void transcripts.load(props.courseId, props.video)
  },
  { immediate: true },
)

watch(
  () => props.active,
  (active) => {
    if (active) {
      asr.startPolling()
      if (follow.value && activeIndex.value >= 0) nextTick(() => scrollToIndex(activeIndex.value, false))
    } else asr.stopPolling()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (props.active) asr.stopPolling()
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col" aria-label="逐字稿">
    <div class="shrink-0 border-b border-linen px-4 py-2 text-caption" aria-label="本机转写管理">
      <div class="flex items-center justify-between gap-2">
        <span role="status" class="min-w-0 text-graphite">{{ asr.state.status === 'ready' ? '本机转写已就绪 · 支持离线使用' : serviceHint || '正在启动本机转写…' }}</span>
        <button v-if="asr.state.status === 'offline'" class="shrink-0 font-bold" type="button" @click="asr.startService()">启动</button>
        <button v-else-if="asr.state.status === 'error'" class="shrink-0 font-bold" type="button" :disabled="transcripts.activeJobs.value > 0" @click="asr.retryService()">重新准备</button>
        <button v-else class="shrink-0 text-stone disabled:opacity-40" type="button" :disabled="transcripts.activeJobs.value > 0" @click="asr.stopService()">停止服务</button>
      </div>
      <p v-if="asr.state.status === 'preparing'" class="mt-1 text-stone">首次使用需下载语音模型，完成后可离线转写；准备期间可切换页面。</p>
    </div>
    <!-- 有逐字稿：搜索 + 列表 -->
    <template v-if="state.status === 'ready' || state.status === 'transcribing'">
      <div class="flex items-center gap-2 border-b border-linen px-4 py-3">
        <div class="min-w-0 flex-1">
          <VTextField
            :model-value="query"
            type="search"
            label="搜索逐字稿"
            placeholder="搜索本节逐字稿"
            clearable
            @update:model-value="query = $event ?? ''"
            @keydown.enter.prevent="jumpMatch($event.shiftKey ? -1 : 1)"
          >
            <template #prepend-inner><AppIcon name="search" :size="18" /></template>
          </VTextField>
        </div>
        <template v-if="query">
          <span class="tabular shrink-0 text-caption text-stone">
            {{ matches.length ? `${matchCursor + 1}/${matches.length}` : '0 处' }}
          </span>
          <UiButton variant="text" size="sm" icon title="上一处（⇧ Enter）" :disabled="!matches.length" @click="jumpMatch(-1)">
            <AppIcon name="chevron-down" :size="16" class="rotate-180" />
          </UiButton>
          <UiButton variant="text" size="sm" icon title="下一处（Enter）" :disabled="!matches.length" @click="jumpMatch(1)">
            <AppIcon name="chevron-down" :size="16" />
          </UiButton>
        </template>
      </div>

      <!-- 转写中的进度条 -->
      <div v-if="state.status === 'transcribing'" class="border-b border-linen bg-page-cream px-4 py-2">
        <div class="flex items-center justify-between gap-3 text-caption">
          <span class="font-medium text-charcoal-ink">正在转写… {{ progressText }}</span>
          <button type="button" class="text-stone hover:text-charcoal-ink" @click="transcripts.cancel(courseId, video.path)">取消</button>
        </div>
        <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-linen">
          <div
            class="h-full rounded-full bg-sunbeam-yellow transition-[width] duration-300 ease-soft"
            :class="state.progress === null ? 'w-1/3 animate-pulse' : ''"
            :style="state.progress !== null ? { width: `${Math.max(2, state.progress * 100)}%` } : undefined"
          />
        </div>
      </div>

      <div ref="listEl" class="scroll-soft relative min-h-0 flex-1 overflow-y-auto px-2 py-2" @scroll.passive="onScroll">
        <ol>
          <li
            v-for="(seg, index) in state.segments"
            :key="seg.id"
            :data-index="index"
            class="group flex gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-100 ease-soft"
            :class="index === activeIndex ? 'bg-sunbeam-yellow/25' : 'hover:bg-cream-deep'"
          >
            <button
              type="button"
              class="tabular mt-0.5 h-6 shrink-0 rounded-full px-2 text-caption font-bold transition-colors"
              :class="index === activeIndex ? 'bg-charcoal-ink text-pure-white' : 'bg-page-cream text-graphite group-hover:bg-linen'"
              :title="`跳转至 ${formatTime(seg.start)}`"
              @click="seek(seg.start)"
            >
              {{ formatTime(seg.start) }}
            </button>
            <button
              type="button"
              class="min-w-0 flex-1 text-left text-body-sm leading-relaxed"
              :class="index === activeIndex ? 'text-charcoal-ink' : 'text-graphite'"
              @click="seek(seg.start)"
            >
              <template v-for="(part, i) in splitByRanges(seg.text, matchMap.get(seg.id))" :key="i">
                <mark v-if="part.hit" class="rounded-sm bg-sunbeam-yellow px-0.5 text-charcoal-ink">{{ part.text }}</mark>
                <template v-else>{{ part.text }}</template>
              </template>
            </button>
            <button
              type="button"
              class="mt-0.5 h-6 shrink-0 rounded-full px-2 text-caption font-medium text-stone opacity-0 transition-opacity hover:bg-linen hover:text-charcoal-ink focus-visible:opacity-100 group-hover:opacity-100"
              title="将本句与时间戳插入笔记"
              @click="quote(seg)"
            >
              引用
            </button>
          </li>
        </ol>
        <p v-if="state.status === 'transcribing' && !state.segments.length" class="px-2 py-8 text-center text-body-sm text-stone">
          正在处理音频，识别结果将陆续显示…
        </p>
      </div>

      <footer class="flex items-center justify-between gap-3 border-t border-linen px-4 py-2 text-caption text-stone">
        <span class="truncate">
          <template v-if="state.status === 'ready'">{{ state.segments.length }} 句 · {{ state.fileName }}</template>
          <template v-else>{{ state.segments.length }} 句</template>
        </span>
        <div class="flex shrink-0 items-center gap-2">
          <button
            v-if="!follow"
            type="button"
            class="rounded-full bg-charcoal-ink px-2.5 py-1 font-bold text-pure-white shadow-subtle"
            @click="resumeFollow"
          >
            定位当前句
          </button>
          <button
            v-if="state.status === 'ready'"
            type="button"
            class="hover:text-charcoal-ink"
            :disabled="asr.state.status !== 'ready'"
            @click="retranscribe"
          >
            重新转写
          </button>
        </div>
      </footer>
    </template>

    <!-- 没有逐字稿：引导 -->
    <div v-else class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <template v-if="state.status === 'loading' || state.status === 'idle'">
        <p class="text-body-sm text-stone">正在查找字幕…</p>
      </template>

      <template v-else>
        <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-sunbeam-yellow text-charcoal-ink" aria-hidden="true">
          <AppIcon name="note" :size="26" />
        </span>
        <h3 class="mt-4 text-body font-bold">本节暂无逐字稿</h3>
        <p class="mt-1 max-w-xs text-body-sm text-graphite">
          转写结果支持逐句跳转、本节全文搜索，并可用于基础课回溯与课后练习。结果保存为视频同名 .srt 文件。
        </p>

        <p v-if="state.status === 'error'" role="alert" class="mt-4 max-w-xs rounded-xl border border-linen bg-pure-white px-3 py-2 text-body-sm text-error">
          {{ state.error }}
        </p>

        <div class="mt-5 flex flex-col items-center gap-2">
          <UiButton variant="primary" :disabled="asr.state.status !== 'ready' || !player.state.ready" @click="startTranscribe">
            转写本节
          </UiButton>
          <p v-if="asr.state.status === 'ready' && estimate" class="text-caption text-stone">{{ estimate }}，在本机完成识别</p>
        </div>

      </template>
    </div>
  </section>
</template>

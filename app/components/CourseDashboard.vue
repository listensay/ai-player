<script setup lang="ts">
import type { Course, VideoEntry } from '~/types/course'
import { formatStudyDuration } from '~/utils/guide'

const props = defineProps<{
  course: Course
  stats: { total: number; done: number; started: number }
  currentVideo: VideoEntry | null
}>()

const emit = defineEmits<{
  play: [video: VideoEntry]
  guide: [tab?: 'plan' | 'today' | 'help' | 'settings']
}>()

const progress = useProgress()
const guide = useGuide()
const checkIn = useCheckIn()

const searchQuery = ref('')
const filter = ref<'all' | 'unwatched' | 'done'>('all')

const courseProgressMap = computed(() => {
  return progress.courseProgress(props.course.id)
})

const resumeVideo = computed(() => {
  // 1. 如果有当前选中的视频且未看完，优先用它
  if (props.currentVideo) {
    const p = courseProgressMap.value[props.currentVideo.path]
    if (!p?.done) return props.currentVideo
  }
  // 2. 查找第一个开始学但未看完的
  const inProgress = props.course.videos.find((v) => {
    const p = courseProgressMap.value[v.path]
    return p && !p.done && p.ratio > 0
  })
  if (inProgress) return inProgress
  // 3. 查找第一个完全没看的
  const unstarted = props.course.videos.find((v) => {
    const p = courseProgressMap.value[v.path]
    return !p || !p.done
  })
  if (unstarted) return unstarted
  // 4. 全部看完了，回首课
  return props.course.videos[0] ?? null
})

const progressPercent = computed(() => {
  if (!props.stats.total) return 0
  return Math.min(100, Math.round((props.stats.done / props.stats.total) * 100))
})

const filteredVideos = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return props.course.videos.filter((v) => {
    if (q && !v.title.toLowerCase().includes(q) && !v.path.toLowerCase().includes(q)) {
      return false
    }
    const p = courseProgressMap.value[v.path]
    if (filter.value === 'done') return !!p?.done
    if (filter.value === 'unwatched') return !p?.done
    return true
  })
})

function getVideoProgress(path: string) {
  return courseProgressMap.value[path]
}

function startResume() {
  if (resumeVideo.value) {
    emit('play', resumeVideo.value)
  }
}
</script>

<template>
  <div class="scroll-soft min-h-0 flex-1 overflow-y-auto bg-page-cream p-4 sm:p-6 lg:p-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <!-- 课程头部 Hero 卡片 -->
      <section class="pane relative overflow-hidden p-6 sm:p-7">
        <div class="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="inline-flex items-center gap-1.5 rounded-full border border-linen bg-page-cream px-3 py-1 text-caption font-bold text-stone">
                <AppIcon name="folder" :size="13" class="text-stone" />
                本地课程
              </span>
              <span v-if="guide.state.plan" class="inline-flex items-center gap-1 rounded-full bg-deep-indigo/10 px-3 py-1 text-caption font-bold text-deep-indigo">
                <AppIcon name="sparkles" :size="13" />
                已定制 AI 路线
              </span>
            </div>

            <!-- 课程名称：支持自然换行与适中字号，彻底告别单行粗暴截断 -->
            <h1 class="mt-2.5 break-words text-heading font-bold leading-snug text-charcoal-ink sm:text-heading-lg" :title="course.name">
              {{ course.name }}
            </h1>

            <!-- 统计数据小标签 -->
            <div class="mt-3 flex flex-wrap items-center gap-2.5 text-caption text-graphite">
              <span class="font-bold text-charcoal-ink">共 {{ stats.total }} 集</span>
              <span class="text-stone">·</span>
              <span>已看完 <strong class="text-emerald-700">{{ stats.done }}</strong> 集</span>
              <span class="text-stone">·</span>
              <span>在学中 <strong class="text-brand-orange">{{ stats.started }}</strong> 集</span>
              <span v-if="guide.schedule.value?.days" class="text-stone">· 预计还需 {{ guide.schedule.value.days }} 天</span>
            </div>

            <!-- 进度条 -->
            <div class="mt-4 flex max-w-md items-center gap-3">
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-linen">
                <div
                  class="h-full rounded-full bg-brand-orange transition-all duration-300"
                  :style="{ width: `${progressPercent}%` }"
                />
              </div>
              <span class="text-caption font-bold text-charcoal-ink tabular">{{ progressPercent }}% 完成</span>
            </div>
          </div>

          <!-- 快速启动主按钮区：整洁规范的按钮，下方附带当前课节名 -->
          <div class="flex flex-col items-start gap-2 lg:items-end">
            <div class="flex flex-wrap items-center gap-2.5">
              <UiButton
                v-if="resumeVideo"
                variant="dark"
                size="lg"
                class="shadow-subtle gap-2"
                @click="startResume"
              >
                <AppIcon name="play" :size="18" />
                <span>{{ stats.done === stats.total ? '复习首课' : stats.started || stats.done ? '继续学习' : '开始学习' }}</span>
              </UiButton>

              <UiButton variant="ghost" size="lg" class="gap-2" @click="emit('guide')">
                <AppIcon name="sparkles" :size="18" class="text-deep-indigo" />
                <span>{{ guide.state.plan ? '学习路线' : 'AI 定制路线' }}</span>
              </UiButton>
            </div>

            <!-- 优雅展示上次学到或首课信息，不挤在按钮里 -->
            <p v-if="resumeVideo" class="max-w-sm truncate text-caption text-stone lg:text-right" :title="resumeVideo.title">
              <span class="font-medium text-charcoal-ink">{{ stats.started || stats.done ? '上次学到' : '首节课程' }}：</span>第 {{ resumeVideo.index + 1 }} 集 · {{ resumeVideo.title }}
            </p>
          </div>
        </div>
      </section>

      <!-- 双栏板块：打卡日历 & 今日学习任务 -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <!-- 左侧：每日学习打卡日历 (占 7 列) -->
        <section class="pane p-5 sm:p-6 lg:col-span-7" aria-label="学习打卡日历">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 class="text-subheading text-charcoal-ink">每日学习打卡</h3>
              <p class="mt-0.5 text-caption text-stone">
                {{ guide.state.plan ? `跟随 AI 规划投入，达标自动打勾 ✓` : '定制每日规划，持之以恒记录' }}
              </p>
            </div>
            <UiButton size="sm" variant="ghost" @click="emit('guide', 'plan')">
              {{ guide.state.plan ? '调整规划时间' : '定制路线' }}
            </UiButton>
          </div>

          <CheckInCalendar @plan="emit('guide', 'plan')" />
        </section>

        <!-- 右侧：今日安排与导学状态 (占 5 列) -->
        <section class="flex flex-col gap-6 lg:col-span-5">
          <!-- 今日学习任务卡片 -->
          <div class="pane flex-1 p-5 sm:p-6">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-subheading text-charcoal-ink">今日安排</h3>
                <p class="mt-0.5 text-caption text-stone">{{ guide.state.today?.date ?? '今日规划' }}</p>
              </div>
              <UiButton size="sm" variant="ghost" @click="emit('guide', 'today')">
                管理安排 →
              </UiButton>
            </div>

            <!-- 今日清单 -->
            <div v-if="guide.state.today?.items.length" class="mt-4 space-y-2.5">
              <div
                v-for="item in guide.state.today.items"
                :key="item.id"
                class="flex items-start gap-3 rounded-xl border border-linen bg-pure-white p-3 transition-colors hover:border-charcoal-ink/30"
              >
                <input
                  type="checkbox"
                  :checked="item.done"
                  class="mt-1 accent-charcoal-ink"
                  @change="guide.completeTodayItem(item.id, ($event.target as HTMLInputElement).checked)"
                />
                <div class="min-w-0 flex-1">
                  <button
                    type="button"
                    class="block text-left text-body-sm font-bold text-charcoal-ink hover:underline"
                    :class="item.done ? 'line-through text-stone' : ''"
                    @click="() => {
                      const v = course.videos.find(v => v.path === item.path)
                      if (v) emit('play', v)
                    }"
                  >
                    {{ course.videos.find(v => v.path === item.path)?.title ?? item.path }}
                  </button>
                  <p class="mt-1 text-caption text-stone">
                    {{ item.kind === 'question' ? '处理疑问' : '学习片段' }} · {{ formatStudyDuration(item.seconds) }}
                  </p>
                </div>
              </div>
            </div>

            <!-- 无今日安排时的空状态 -->
            <div v-else class="mt-6 rounded-xl border border-linen bg-pure-white p-6 text-center">
              <p class="text-body-sm text-stone">
                {{ guide.state.plan ? '今日待办已全部完成，或可在导学中刷新安排。' : '尚未定制 AI 学习路线，先让 AI 为你规划节奏。' }}
              </p>
              <UiButton
                variant="primary"
                size="sm"
                class="mt-4"
                @click="emit('guide', guide.state.plan ? 'today' : 'plan')"
              >
                {{ guide.state.plan ? '查看今日学习' : '一键定制路线' }}
              </UiButton>
            </div>

            <!-- 待解决疑问提示 -->
            <div v-if="guide.unresolvedQuestions.value.length" class="mt-4 rounded-xl border border-linen bg-page-cream p-3.5">
              <div class="flex items-center justify-between">
                <span class="text-caption font-bold text-charcoal-ink">
                  卡点待解决 ({{ guide.unresolvedQuestions.value.length }})
                </span>
                <button type="button" class="text-caption font-bold text-stone underline" @click="emit('guide', 'help')">
                  去回溯基础
                </button>
              </div>
              <p class="mt-1 truncate text-caption text-stone">
                {{ guide.unresolvedQuestions.value[0]?.text }}
              </p>
            </div>
          </div>
        </section>
      </div>

      <!-- 课程目录全景列表 -->
      <section class="pane p-5 sm:p-6" aria-label="课程章节目录">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 class="text-subheading text-charcoal-ink">课程全景章节</h3>
            <p class="mt-0.5 text-caption text-stone">点击任意一集即可进入播放页面开始学习</p>
          </div>

          <!-- 搜索与筛选 -->
          <div class="flex flex-wrap items-center gap-2">
            <input
              v-model="searchQuery"
              type="search"
              placeholder="搜索课节名称…"
              class="w-44 rounded-xl border border-linen bg-pure-white px-3 py-1.5 text-caption text-charcoal-ink placeholder:text-stone focus:border-charcoal-ink focus:outline-none sm:w-56"
            />
            <div class="flex items-center rounded-xl border border-linen bg-pure-white p-0.5 text-caption font-medium text-stone">
              <button
                type="button"
                class="rounded-lg px-2.5 py-1 transition-colors"
                :class="filter === 'all' ? 'bg-charcoal-ink text-pure-white font-bold' : 'hover:text-charcoal-ink'"
                @click="filter = 'all'"
              >
                全部 ({{ stats.total }})
              </button>
              <button
                type="button"
                class="rounded-lg px-2.5 py-1 transition-colors"
                :class="filter === 'unwatched' ? 'bg-charcoal-ink text-pure-white font-bold' : 'hover:text-charcoal-ink'"
                @click="filter = 'unwatched'"
              >
                待学 ({{ stats.total - stats.done }})
              </button>
              <button
                type="button"
                class="rounded-lg px-2.5 py-1 transition-colors"
                :class="filter === 'done' ? 'bg-charcoal-ink text-pure-white font-bold' : 'hover:text-charcoal-ink'"
                @click="filter = 'done'"
              >
                已看 ({{ stats.done }})
              </button>
            </div>
          </div>
        </div>

        <!-- 课节列表卡片网格 -->
        <div class="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="v in filteredVideos"
            :key="v.path"
            class="group flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-linen bg-pure-white p-3.5 transition-all hover:border-charcoal-ink hover:shadow-xs"
            @click="emit('play', v)"
          >
            <div class="flex min-w-0 items-center gap-3">
              <!-- 序号 / 完成图标 -->
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-caption font-bold transition-colors"
                :class="[
                  getVideoProgress(v.path)?.done
                    ? 'bg-emerald-100 text-emerald-800'
                    : getVideoProgress(v.path)?.ratio
                    ? 'bg-sunbeam-yellow/40 text-charcoal-ink'
                    : 'bg-page-cream text-stone'
                ]"
              >
                <AppIcon v-if="getVideoProgress(v.path)?.done" name="check" :size="14" />
                <span v-else>{{ String(v.index + 1).padStart(2, '0') }}</span>
              </span>

              <div class="min-w-0 flex-1">
                <p class="truncate text-body-sm font-bold text-charcoal-ink group-hover:text-deep-indigo" :title="v.title">
                  {{ v.title }}
                </p>
                <div class="mt-0.5 flex items-center gap-2 text-caption text-stone">
                  <span v-if="getVideoProgress(v.path)?.done" class="text-emerald-700 font-medium">已看完</span>
                  <span v-else-if="getVideoProgress(v.path)?.ratio" class="text-brand-orange font-medium">
                    已看 {{ Math.round((getVideoProgress(v.path)?.ratio ?? 0) * 100) }}%
                  </span>
                  <span v-else>未学习</span>
                  <span v-if="v.dir" class="truncate opacity-75">· {{ v.dir }}</span>
                </div>
              </div>
            </div>

            <!-- 播放箭头 -->
            <span class="shrink-0 text-stone group-hover:text-charcoal-ink group-hover:translate-x-0.5 transition-transform">
              <AppIcon name="chevron-right" :size="16" />
            </span>
          </div>
        </div>

        <div v-if="!filteredVideos.length" class="py-12 text-center text-body-sm text-stone">
          没有找到匹配的课节
        </div>
      </section>
    </div>
  </div>
</template>

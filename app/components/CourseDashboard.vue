<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import { useProgress } from '~/composables/useProgress'
import { useCheckIn } from '~/composables/useStudyCheckIn'
import AppIcon from '~/components/AppIcon.vue'
import CheckInCalendar from '~/components/CheckInCalendar.vue'
import LessonBadge from '~/components/LessonBadge.vue'
import StagePanel from '~/components/StagePanel.vue'
import StageProgressBars from '~/components/StageProgressBars.vue'
import TodayWorkList from '~/components/TodayWorkList.vue'
import UiButton from '~/components/UiButton.vue'
import type { Course, VideoEntry } from '~/types/course'
import type { TodayItem } from '~/types/guide'
import { formatStudyDuration } from '~/utils/guide'
import { localDayKey } from '~/utils/learningFeedback'
import { BUDGET_LABELS, WORK_KINDS, conciseLessonTitle, conciseSource, formatMinutes } from '~/utils/studyProgram'

const props = defineProps<{
  course: Course
  stats: { total: number; done: number; started: number }
  currentVideo: VideoEntry | null
}>()

const emit = defineEmits<{
  play: [video: VideoEntry]
  segment: [item: TodayItem]
  guide: [tab?: 'plan' | 'today' | 'help' | 'settings']
}>()

const progress = useProgress()
const guide = useGuide()
const checkIn = useCheckIn()

const searchQuery = ref('')
const filter = ref<'all' | 'unwatched' | 'done'>('all')
const routeView = guide.routeView
const displayedVideos = computed(() => routeView.value ? guide.routeVideos.value : props.course.videos)
const moduleTitles = computed(() => new Map(guide.state.plan?.modules.map(m => [m.id, m.title]) ?? []))
function routeModule(path: string) { return guide.lessonMap.value.get(path)?.moduleId }
function lessonNumber(v: VideoEntry) { return routeView.value ? guide.routePositions.value.get(v.path) : v.index + 1 }
/** 路线视图使用精简标题，序号前缀和课程系列名由阶段分组与来源说明承担。 */
function lessonTitle(v: VideoEntry) { return routeView.value ? conciseLessonTitle(v.title) : v.title }

const courseProgressMap = computed(() => progress.courseProgress(props.course.id))
const viewStats = computed(() => routeView.value ? {
  total: displayedVideos.value.length,
  done: displayedVideos.value.filter(v => courseProgressMap.value[v.path]?.done).length,
  started: displayedVideos.value.filter(v => { const p = courseProgressMap.value[v.path]; return p && !p.done && p.ratio > 0 }).length,
} : props.stats)

const resumeVideo = computed(() => {
  if (routeView.value) return guide.firstLesson.value ? guide.videoMap.value.get(guide.firstLesson.value.path) ?? null : null
  if (props.currentVideo && !courseProgressMap.value[props.currentVideo.path]?.done) return props.currentVideo
  const inProgress = props.course.videos.find((v) => { const p = courseProgressMap.value[v.path]; return p && !p.done && p.ratio > 0 })
  if (inProgress) return inProgress
  return props.course.videos.find(v => !courseProgressMap.value[v.path]?.done) ?? props.course.videos[0] ?? null
})

const progressPercent = computed(() => viewStats.value.total ? Math.min(100, Math.round((viewStats.value.done / viewStats.value.total) * 100)) : 0)

const filteredVideos = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return displayedVideos.value.filter((v) => {
    if (q && !v.title.toLowerCase().includes(q) && !v.path.toLowerCase().includes(q)) return false
    const p = courseProgressMap.value[v.path]
    if (filter.value === 'done') return !!p?.done
    if (filter.value === 'unwatched') return !p?.done
    return true
  })
})
function getVideoProgress(path: string) { return courseProgressMap.value[path] }
function startResume() { if (resumeVideo.value) emit('play', resumeVideo.value) }

// —— 时间口径：完整计划与视频排期分开说明 ——
const timeSummary = computed(() => {
  const plan = guide.state.plan
  if (!plan) return null
  const s = guide.schedule.value
  const video = `路线视频剩余 ${formatStudyDuration(s.remainingSeconds)}${s.unknown ? `（含 ${s.unknown} 节估算时长）` : ''}`
  const program = guide.program.value
  if (!program) return { plan: '', video: `${video}，按每日看课 ${formatMinutes(plan.dailyMinutes)} 约需 ${s.days} 天。该天数仅为视频排期。` }
  const day = guide.planDay.value ?? 0
  const status = day < 1 ? `计划将于 ${program.startDate} 开始，共 ${program.days} 天` : day > program.days ? `计划周期（${program.days} 天）已结束` : `计划第 ${day} / ${program.days} 天`
  const finish = guide.videoFinish.value
  const finishText = finish === null ? '路线视频已全部看完' : finish === Infinity ? '当前分配未安排看课时间'
    : finish <= program.days ? `按各阶段看课额度预计第 ${finish} 天看完` : `按当前看课额度需到第 ${finish} 天，超出计划 ${finish - program.days} 天`
  return { plan: status, video: `${video}，${finishText}。` }
})

// —— 今日任务：看课 + 独立编码 + 项目实践 + 复习 ——
const todayVideoSeconds = computed(() => checkIn?.state.days[checkIn.state.date]?.seconds ?? 0)
const allocation = computed(() => {
  const budget = guide.todayBudget.value
  if (!budget) return []
  const work = Object.fromEntries(WORK_KINDS.map(k => [k, guide.todayWork.value.filter(e => e.kind === k).reduce((n, e) => n + e.minutes, 0)]))
  return (['video', ...WORK_KINDS] as const).map(key => ({
    key, label: BUDGET_LABELS[key], target: budget[key],
    done: key === 'video' ? Math.floor(todayVideoSeconds.value / 60) : work[key] ?? 0,
  })).filter(item => item.target > 0 || item.done > 0)
})
const videoItems = computed(() => guide.state.today?.items ?? [])
const nextVideoItem = computed(() => videoItems.value.find(i => !i.done))
function itemTitle(item: TodayItem) {
  if (item.questionId) return guide.state.questions.find(q => q.id === item.questionId)?.text ?? '处理疑问'
  const video = guide.videoMap.value.get(item.path)
  return video ? conciseLessonTitle(video.title) : item.path
}
function startItem(item: TodayItem) {
  if (item.questionId) { emit('guide', 'help'); return }
  emit('segment', item)
}
const stageOptions = computed(() => {
  const ids = new Set(guide.route.value.map(l => l.moduleId))
  return (guide.state.plan?.modules ?? []).filter(m => m.practice || ids.has(m.id))
})
const activeModule = guide.activeModule
const stageLag = computed(() => {
  const scheduled = guide.scheduledModule.value, current = guide.progressModule.value
  return scheduled && current && scheduled.id !== current.id ? { scheduled, current } : null
})
const activeProgress = computed(() => activeModule.value ? guide.stageProgressMap.value.get(activeModule.value.id) : undefined)

// —— 近 7 天投入，便于周复盘 ——
const week = computed(() => {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return localDayKey(d) })
  const rows = days.map(date => {
    const video = Math.floor((checkIn?.state.days[date]?.seconds ?? 0) / 60)
    const work = Math.floor((guide.workSecondsByDate.value[date] ?? 0) / 60)
    return { date, label: date.slice(5), video, work, checked: !!checkIn?.state.days[date]?.checkedAt }
  })
  const max = Math.max(60, ...rows.map(r => r.video + r.work))
  return { rows, max, total: rows.reduce((n, r) => n + r.video + r.work, 0) }
})

// —— 路线按阶段折叠：默认展开当前阶段与下一节课所在阶段 ——
const openModules = reactive(new Set<string>())
const searching = computed(() => !!searchQuery.value.trim() || filter.value !== 'all')
watch(() => [activeModule.value?.id, resumeVideo.value ? routeModule(resumeVideo.value.path) : undefined], ids => {
  for (const id of ids) if (id) openModules.add(id)
}, { immediate: true })
const groups = computed(() => {
  const result: Array<{ key: string; moduleId: string; videos: VideoEntry[] }> = []
  for (const v of filteredVideos.value) {
    const id = routeModule(v.path) ?? ''
    const last = result.at(-1)
    if (last?.moduleId === id) last.videos.push(v)
    else result.push({ key: `${id}:${result.length}`, moduleId: id, videos: [v] })
  }
  return result
})
const allOpen = computed(() => groups.value.every(g => openModules.has(g.moduleId)))
function isOpen(id: string) { return searching.value || openModules.has(id) }
function toggleModule(id: string) { if (openModules.has(id)) openModules.delete(id); else openModules.add(id) }
function toggleAll() {
  if (allOpen.value) openModules.clear()
  else for (const g of groups.value) openModules.add(g.moduleId)
}
const moduleStats = computed(() => {
  const result = new Map<string, { total: number; done: number; seconds: number }>()
  for (const lesson of guide.route.value) {
    const entry = result.get(lesson.moduleId) ?? { total: 0, done: 0, seconds: 0 }
    entry.total++
    if (courseProgressMap.value[lesson.path]?.done) entry.done++
    entry.seconds += guide.durations.value[lesson.path] ?? 0
    result.set(lesson.moduleId, entry)
  }
  return result
})
const openStage = ref('')

// —— 推荐说明：为什么学、服务哪个项目、何时可跳过 ——
const openInfo = ref('')
function lessonInfo(path: string) {
  const lesson = guide.lessonMap.value.get(path)
  if (!lesson) return null
  const module = guide.moduleMap.value.get(lesson.moduleId)
  return {
    lesson,
    stage: module?.title ?? '',
    serves: module?.practice?.project ?? module?.description ?? '',
    skipWhen: module?.practice?.skipWhen ?? '已掌握本课全部知识点时，可在导学中标记为“已掌握”，路线将自动略过本课。',
    prerequisites: lesson.prerequisites.map(p => guide.videoMap.value.get(p)).filter((v): v is VideoEntry => !!v).map(v => conciseLessonTitle(v.title)),
  }
}
</script>

<template>
  <div class="scroll-soft min-h-0 flex-1 overflow-y-auto bg-page-cream p-4 sm:p-6 lg:p-8">
    <div class="mx-auto max-w-6xl space-y-6">
      <!-- 课程头部：完整计划与视频排期分开展示 -->
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
              <span v-if="timeSummary?.plan" class="inline-flex items-center rounded-full bg-sunbeam-yellow/30 px-3 py-1 text-caption font-bold text-charcoal-ink" data-testid="plan-day">
                {{ timeSummary.plan }}
              </span>
            </div>

            <h1 class="mt-2.5 text-heading font-bold leading-snug text-charcoal-ink [overflow-wrap:anywhere] sm:text-heading-lg" :title="course.name">
              {{ course.name }}
            </h1>

            <div class="mt-3 flex flex-wrap items-center gap-2.5 text-caption text-graphite">
              <span class="font-bold text-charcoal-ink">{{ routeView ? '路线' : '共' }} {{ viewStats.total }} 节</span>
              <span class="text-stone">·</span>
              <span>已完成 <strong class="text-charcoal-ink">{{ viewStats.done }}</strong> 节</span>
              <span class="text-stone">·</span>
              <span>学习中 <strong class="text-charcoal-ink">{{ viewStats.started }}</strong> 节</span>
            </div>

            <div v-if="timeSummary" class="mt-3 max-w-3xl space-y-1 text-caption leading-relaxed text-graphite" aria-label="时间安排">
              <p v-if="guide.program.value">
                <span class="font-bold text-charcoal-ink">每日总投入 {{ formatMinutes(guide.todayTotalMinutes.value ?? 0) }}</span>
                <template v-if="allocation.length">：{{ allocation.map(a => `${a.label} ${formatMinutes(a.target)}`).join(' · ') }}</template>
                <template v-if="guide.lightDay.value">（今日为轻量复盘日）</template>
              </p>
              <p>{{ timeSummary.video }}</p>
              <p v-if="!guide.program.value" class="text-stone">
                未设置完整学习计划，当前仅安排看课。
                <button type="button" class="font-bold text-charcoal-ink underline" @click="emit('guide', 'plan')">设置总周期与每日分配</button>
              </p>
            </div>

            <div class="mt-4 flex max-w-md items-center gap-3">
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-linen">
                <div class="h-full rounded-full bg-charcoal-ink transition-all duration-300" :style="{ width: `${progressPercent}%` }" />
              </div>
              <span class="text-caption font-bold text-charcoal-ink tabular">视频 {{ progressPercent }}%</span>
            </div>
          </div>

          <div class="flex min-w-0 flex-col items-start gap-2 lg:max-w-sm lg:items-end">
            <div class="flex flex-wrap items-center gap-2.5">
              <UiButton v-if="resumeVideo" variant="dark" size="lg" class="gap-2" @click="startResume">
                <AppIcon name="play" :size="18" />
                <span>{{ viewStats.done === viewStats.total ? '复习首课' : viewStats.started || viewStats.done ? '继续学习' : '开始学习' }}</span>
              </UiButton>
              <UiButton variant="ghost" size="lg" class="gap-2" @click="emit('guide')">
                <AppIcon name="sparkles" :size="18" class="text-deep-indigo" />
                <span>{{ guide.state.plan ? '学习路线' : 'AI 定制路线' }}</span>
              </UiButton>
            </div>
            <p v-if="resumeVideo" class="max-w-full text-caption leading-relaxed text-stone [overflow-wrap:anywhere] lg:text-right" :title="resumeVideo.title">
              <span class="font-medium text-charcoal-ink">{{ routeView ? '接下来学习' : stats.started || stats.done ? '最近学习' : '首节课程' }}：</span>第 {{ lessonNumber(resumeVideo) }} 节 · {{ lessonTitle(resumeVideo) }}
            </p>
          </div>
        </div>
      </section>

      <!-- 今日任务中心 -->
      <section class="pane p-5 sm:p-6" aria-label="今日任务">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-subheading text-charcoal-ink">今日任务</h2>
            <p class="mt-0.5 text-caption text-stone">
              {{ guide.todayDate.value }}<template v-if="guide.program.value && guide.planDay.value && guide.planDay.value >= 1"> · 计划第 {{ guide.planDay.value }} 天</template>
              <template v-if="guide.lightDay.value"> · 轻量复盘日，不安排新课</template>
            </p>
          </div>
          <UiButton size="sm" variant="ghost" @click="emit('guide', 'today')">管理安排 →</UiButton>
        </div>

        <div class="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div class="min-w-0 space-y-5 lg:col-span-7">
            <!-- 每日时间分配与完成情况 -->
            <ul v-if="allocation.length" class="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="今日时间分配">
              <li v-for="item in allocation" :key="item.key" class="min-w-0 rounded-xl border border-linen bg-page-cream p-3">
                <p class="truncate text-caption text-stone">{{ item.label }}</p>
                <p class="mt-1 text-body-sm font-bold tabular">{{ item.done }}<span class="font-normal text-stone"> / {{ item.target }} 分钟</span></p>
                <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-linen"><div class="h-full rounded-full bg-charcoal-ink" :style="{ width: `${item.target ? Math.min(100, Math.round(item.done / item.target * 100)) : 100}%` }" /></div>
              </li>
            </ul>

            <div>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="text-body-sm font-bold">看课 / 回看</h3>
                <UiButton v-if="nextVideoItem" size="sm" variant="dark" @click="startItem(nextVideoItem)"><AppIcon name="play" :size="14" />播放下一段</UiButton>
              </div>
              <ul v-if="videoItems.length" class="mt-2 space-y-2">
                <li v-for="item in videoItems" :key="item.id" class="flex items-start gap-3 rounded-xl border border-linen bg-pure-white p-3">
                  <input type="checkbox" :checked="item.done" class="mt-1 accent-charcoal-ink" :aria-label="`完成：${itemTitle(item)}`"
                    @change="guide.completeTodayItem(item.id, ($event.target as HTMLInputElement).checked)" />
                  <div class="min-w-0 flex-1">
                    <button type="button" class="block max-w-full text-left text-body-sm font-bold text-charcoal-ink [overflow-wrap:anywhere] hover:underline"
                      :class="item.done ? 'text-stone line-through' : ''" @click="startItem(item)">{{ itemTitle(item) }}</button>
                    <p class="mt-1 text-caption text-stone">{{ item.kind === 'question' ? '处理疑问' : item.kind === 'review' ? '补学基础' : '学习片段' }} · {{ formatStudyDuration(item.seconds) }}{{ item.estimated ? '（估算）' : '' }}</p>
                  </div>
                </li>
              </ul>
              <p v-else class="mt-2 rounded-xl border border-linen bg-pure-white p-3 text-caption text-stone">
                {{ !guide.state.plan ? '尚未生成学习路线。' : guide.lightDay.value || guide.todayBudget.value?.video === 0 ? '今日未安排看课。' : '当前没有待学课节。' }}
              </p>
            </div>

            <div>
              <h3 class="text-body-sm font-bold">实践任务</h3>
              <TodayWorkList v-if="guide.todayWork.value.length" class="mt-2" />
              <div v-else class="mt-2 rounded-xl border border-linen bg-pure-white p-3 text-caption leading-relaxed text-stone">
                <template v-if="!guide.state.plan">生成学习路线并设置完整学习计划后，这里会安排编码、项目与复习任务。</template>
                <template v-else-if="!guide.program.value">未设置完整学习计划，今日只安排看课。<button type="button" class="font-bold text-charcoal-ink underline" @click="emit('guide', 'plan')">设置计划</button></template>
                <template v-else-if="(guide.planDay.value ?? 0) < 1">计划尚未开始。</template>
                <template v-else-if="!activeModule?.practice">当前阶段尚未设置实践任务。<button type="button" class="font-bold text-charcoal-ink underline" @click="emit('guide', 'plan')">补全实践安排</button></template>
                <template v-else>当前阶段的实践任务均已完成，可在阶段验收中记录成果。</template>
              </div>
            </div>
          </div>

          <aside class="min-w-0 space-y-4 lg:col-span-5">
            <div v-if="guide.state.plan && activeModule" class="rounded-2xl border border-linen bg-page-cream p-4" aria-label="阶段进度">
              <label class="block text-caption font-bold text-stone">当前阶段
                <select class="mt-1 w-full rounded-lg border border-linen bg-pure-white px-2 py-1.5 text-body-sm font-bold text-charcoal-ink" :value="guide.state.records.activeModuleId"
                  @change="guide.setActiveModule(($event.target as HTMLSelectElement).value)">
                  <option value="">{{ guide.scheduledModule.value ? `按计划日期：${guide.scheduledModule.value.title}` : `按学习进度：${(guide.progressModule.value ?? activeModule).title}` }}</option>
                  <option v-for="m in stageOptions" :key="m.id" :value="m.id">{{ m.title }}</option>
                </select>
              </label>
              <p v-if="activeModule.practice" class="mt-3 text-caption leading-relaxed text-graphite [overflow-wrap:anywhere]"><strong class="text-charcoal-ink">阶段目标：</strong>{{ activeModule.practice.goal }}</p>
              <p v-else class="mt-3 text-caption leading-relaxed text-graphite [overflow-wrap:anywhere]">{{ activeModule.description }}</p>
              <StageProgressBars v-if="activeProgress" class="mt-3" :progress="activeProgress" />
              <p v-if="stageLag" class="mt-3 rounded-lg bg-pure-white p-2.5 text-caption leading-relaxed text-graphite">
                计划日期已进入“{{ stageLag.scheduled.title }}”，视频进度仍在“{{ stageLag.current.title }}”。可在复盘日补齐，或切换当前阶段。
              </p>
              <button type="button" class="mt-3 text-caption font-bold underline" @click="openStage = activeModule.id; openModules.add(activeModule.id); searchQuery = ''; filter = 'all'; guide.state.view = 'route'">查看阶段验收</button>
            </div>
            <div v-else class="rounded-2xl border border-linen bg-page-cream p-4 text-center">
              <p class="text-body-sm text-stone">尚未生成学习路线，请先设置学习目标与每日时间。</p>
              <UiButton variant="primary" size="sm" class="mt-3" @click="emit('guide', 'plan')">定制学习路线</UiButton>
            </div>

            <div v-if="guide.unresolvedQuestions.value.length" class="rounded-2xl border border-linen bg-pure-white p-4">
              <div class="flex items-center justify-between gap-2">
                <span class="text-caption font-bold text-charcoal-ink">待解决疑问（{{ guide.unresolvedQuestions.value.length }}）</span>
                <button type="button" class="text-caption font-bold text-stone underline" @click="emit('guide', 'help')">查找基础课</button>
              </div>
              <p class="mt-1 text-caption leading-relaxed text-stone [overflow-wrap:anywhere]">{{ guide.unresolvedQuestions.value[0]?.text }}</p>
            </div>
          </aside>
        </div>
      </section>

      <!-- 课程目录 / 学习路线 -->
      <section class="pane p-5 sm:p-6" aria-label="课程章节目录">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 class="text-subheading text-charcoal-ink">{{ routeView ? '学习路线' : '课程目录' }}</h3>
            <p class="mt-0.5 text-caption text-stone">{{ routeView ? '按学习阶段和先修顺序排列，序号为路线顺序；默认展开当前阶段' : '按原课程目录排列，选择课节进入播放器' }}</p>
          </div>
          <div class="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <input v-model="searchQuery" type="search" placeholder="搜索课节名称…"
              class="w-full min-w-0 rounded-xl border border-linen bg-pure-white px-3 py-1.5 text-caption text-charcoal-ink placeholder:text-stone focus:border-charcoal-ink focus:outline-none sm:w-56" />
            <div class="flex max-w-full flex-wrap items-center rounded-xl border border-linen bg-pure-white p-0.5 text-caption font-medium text-stone">
              <button type="button" class="whitespace-nowrap rounded-lg px-2.5 py-1 transition-colors" :class="filter === 'all' ? 'bg-charcoal-ink text-pure-white font-bold' : 'hover:text-charcoal-ink'" @click="filter = 'all'">全部 ({{ viewStats.total }})</button>
              <button type="button" class="whitespace-nowrap rounded-lg px-2.5 py-1 transition-colors" :class="filter === 'unwatched' ? 'bg-charcoal-ink text-pure-white font-bold' : 'hover:text-charcoal-ink'" @click="filter = 'unwatched'">待学 ({{ viewStats.total - viewStats.done }})</button>
              <button type="button" class="whitespace-nowrap rounded-lg px-2.5 py-1 transition-colors" :class="filter === 'done' ? 'bg-charcoal-ink text-pure-white font-bold' : 'hover:text-charcoal-ink'" @click="filter = 'done'">已完成 ({{ viewStats.done }})</button>
            </div>
          </div>
        </div>

        <div v-if="guide.state.plan" class="mt-4 flex flex-wrap items-center gap-3">
          <div class="flex rounded-full bg-page-cream p-1" aria-label="概览目录视图">
            <button type="button" :aria-pressed="routeView" class="rounded-full px-4 py-1.5 text-caption font-bold" :class="routeView ? 'bg-charcoal-ink text-pure-white' : 'text-stone'" @click="guide.state.view = 'route'">AI 定制路线</button>
            <button type="button" :aria-pressed="!routeView" class="rounded-full px-4 py-1.5 text-caption font-bold" :class="!routeView ? 'bg-pure-white' : 'text-stone'" @click="guide.state.view = 'all'">完整目录</button>
          </div>
          <label v-if="routeView" class="flex items-center gap-2 text-caption text-stone"><input v-model="guide.state.includeOptional" type="checkbox" class="accent-charcoal-ink" />包含选修 / 查漏</label>
          <button v-if="routeView && groups.length > 1 && !searching" type="button" class="text-caption font-bold underline" @click="toggleAll">{{ allOpen ? '全部收起' : '全部展开' }}</button>
          <button v-if="guide.state.records.undo" type="button" class="ml-auto text-caption font-bold text-stone underline" :disabled="!!guide.state.busy" @click="guide.undo()">撤销：{{ guide.state.records.undo.label }}</button>
        </div>
        <p v-if="guide.state.notice && guide.state.notice.startsWith('已撤销')" role="status" class="mt-3 text-caption text-stone">{{ guide.state.notice }}</p>

        <!-- 路线视图：按阶段折叠 -->
        <div v-if="routeView" class="mt-5 space-y-3">
          <section v-for="group in groups" :key="group.key" class="rounded-2xl border border-linen" :data-module="group.moduleId" :aria-label="moduleTitles.get(group.moduleId) ?? '未分组课节'">
            <button type="button" class="flex w-full items-start gap-3 rounded-2xl p-4 text-left hover:bg-cream-deep" :aria-expanded="isOpen(group.moduleId)" @click="toggleModule(group.moduleId)">
              <AppIcon name="chevron-right" :size="18" class="mt-0.5 shrink-0 text-stone transition-transform" :class="isOpen(group.moduleId) ? 'rotate-90' : ''" />
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="text-body-sm font-bold text-deep-indigo [overflow-wrap:anywhere]">{{ moduleTitles.get(group.moduleId) }}</span>
                  <span v-if="group.moduleId === activeModule?.id" class="rounded-full bg-sunbeam-yellow px-2 py-0.5 text-[11px] font-bold text-charcoal-ink">当前阶段</span>
                  <span v-if="guide.stageProgressMap.value.get(group.moduleId)?.complete" class="rounded-full bg-charcoal-ink px-2 py-0.5 text-[11px] font-bold text-pure-white">阶段完成</span>
                </span>
                <span class="mt-1 block text-caption text-stone">
                  <template v-if="guide.moduleMap.value.get(group.moduleId)?.practice">第 {{ guide.moduleMap.value.get(group.moduleId)!.practice!.startDay }}–{{ guide.moduleMap.value.get(group.moduleId)!.practice!.endDay }} 天 · </template>
                  必修 {{ moduleStats.get(group.moduleId)?.total ?? group.videos.length }} 节 · 已看 {{ moduleStats.get(group.moduleId)?.done ?? 0 }} 节
                  <template v-if="moduleStats.get(group.moduleId)?.seconds"> · 视频约 {{ formatStudyDuration(moduleStats.get(group.moduleId)!.seconds) }}</template>
                  <template v-if="guide.moduleMap.value.get(group.moduleId)?.practice?.checks.length"> · 验收 {{ (guide.stageProgressMap.value.get(group.moduleId)?.exercise.done ?? 0) + (guide.stageProgressMap.value.get(group.moduleId)?.project.done ?? 0) }}/{{ guide.moduleMap.value.get(group.moduleId)!.practice!.checks.length }}</template>
                </span>
              </span>
            </button>
            <div v-if="isOpen(group.moduleId)" class="border-t border-linen px-4 pt-3 pb-4">
              <div v-if="guide.moduleMap.value.get(group.moduleId)" class="mb-3 flex flex-wrap items-start justify-between gap-3">
                <p class="min-w-0 flex-1 text-caption leading-relaxed text-graphite [overflow-wrap:anywhere]">
                  <template v-if="guide.moduleMap.value.get(group.moduleId)!.practice"><strong class="text-charcoal-ink">阶段交付：</strong>{{ guide.moduleMap.value.get(group.moduleId)!.practice!.project }}</template>
                  <template v-else>{{ guide.moduleMap.value.get(group.moduleId)!.description.slice(0, 160) }}{{ guide.moduleMap.value.get(group.moduleId)!.description.length > 160 ? '…' : '' }}</template>
                </p>
                <button type="button" class="shrink-0 text-caption font-bold underline" :aria-expanded="openStage === group.moduleId" @click="openStage = openStage === group.moduleId ? '' : group.moduleId">
                  {{ openStage === group.moduleId ? '收起阶段详情' : '阶段目标与验收' }}
                </button>
              </div>
              <div v-if="openStage === group.moduleId && guide.moduleMap.value.get(group.moduleId)" class="mb-4 rounded-xl bg-page-cream/60 p-3">
                <StageProgressBars v-if="guide.stageProgressMap.value.get(group.moduleId)" class="mb-4" inline :progress="guide.stageProgressMap.value.get(group.moduleId)!" />
                <StagePanel :module="guide.moduleMap.value.get(group.moduleId)!" />
              </div>
              <div class="course-lesson-grid grid items-start gap-3">
                <div v-for="v in group.videos" :key="v.path" class="flex min-w-0 flex-col rounded-2xl border border-linen bg-pure-white transition-colors hover:border-charcoal-ink">
                  <button type="button" :data-path="v.path" :data-route-position="guide.routePositions.value.get(v.path)" :title="v.title"
                    class="group flex w-full min-w-0 items-start gap-3 p-4 text-left" @click="emit('play', v)">
                    <span class="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-xl px-2 text-caption font-bold"
                      :class="getVideoProgress(v.path)?.done ? 'bg-charcoal-ink text-pure-white' : getVideoProgress(v.path)?.ratio ? 'bg-sunbeam-yellow/40 text-charcoal-ink' : 'bg-page-cream text-stone'">
                      <AppIcon v-if="getVideoProgress(v.path)?.done" name="check" :size="14" />
                      <span v-else>{{ String(lessonNumber(v)).padStart(2, '0') }}</span>
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block whitespace-normal text-body-sm font-bold leading-relaxed text-charcoal-ink [overflow-wrap:anywhere] group-hover:text-deep-indigo">{{ lessonTitle(v) }}</span>
                      <span class="mt-1.5 flex flex-wrap items-start gap-x-3 gap-y-1 text-caption text-stone">
                        <span v-if="getVideoProgress(v.path)?.done" class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink">已完成</span>
                        <span v-else-if="getVideoProgress(v.path)?.ratio" class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink">已看 {{ Math.round((getVideoProgress(v.path)?.ratio ?? 0) * 100) }}%</span>
                        <span v-else class="shrink-0 whitespace-nowrap">未学习</span>
                        <span v-if="v.dir" class="min-w-0 [overflow-wrap:anywhere]">{{ conciseSource(v.dir) }}</span>
                      </span>
                    </span>
                    <span class="mt-2 shrink-0 text-stone transition-transform group-hover:translate-x-0.5 group-hover:text-charcoal-ink"><AppIcon name="chevron-right" :size="16" /></span>
                  </button>
                  <div v-if="lessonInfo(v.path)" class="border-t border-linen px-4 py-2">
                    <button type="button" class="text-caption font-bold text-deep-indigo" :aria-expanded="openInfo === v.path" @click="openInfo = openInfo === v.path ? '' : v.path">
                      {{ openInfo === v.path ? '收起推荐说明' : '为什么学这节' }}
                    </button>
                    <dl v-if="openInfo === v.path" class="mt-2 space-y-2 pb-1 text-caption leading-relaxed text-graphite" :aria-label="`${lessonTitle(v)} 推荐说明`">
                      <div class="flex items-center gap-2"><LessonBadge :status="lessonInfo(v.path)!.lesson.status" compact /><span class="text-stone">{{ lessonInfo(v.path)!.stage }}</span></div>
                      <div><dt class="font-bold text-charcoal-ink">推荐原因</dt><dd class="[overflow-wrap:anywhere]">{{ lessonInfo(v.path)!.lesson.reason }}</dd></div>
                      <div v-if="lessonInfo(v.path)!.serves"><dt class="font-bold text-charcoal-ink">服务的项目与目标</dt><dd class="[overflow-wrap:anywhere]">{{ lessonInfo(v.path)!.serves }}</dd></div>
                      <div><dt class="font-bold text-charcoal-ink">可以跳过的条件</dt><dd class="[overflow-wrap:anywhere]">{{ lessonInfo(v.path)!.skipWhen }}</dd></div>
                      <div v-if="lessonInfo(v.path)!.prerequisites.length"><dt class="font-bold text-charcoal-ink">先修课节</dt><dd class="[overflow-wrap:anywhere]">{{ lessonInfo(v.path)!.prerequisites.join('、') }}</dd></div>
                      <div><dt class="font-bold text-charcoal-ink">原文件</dt><dd class="text-stone [overflow-wrap:anywhere]">{{ v.path }}</dd></div>
                      <button type="button" class="font-bold underline" @click="emit('guide', 'plan')">调整学习状态</button>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- 完整目录 -->
        <div v-else class="course-lesson-grid mt-5 grid gap-3">
          <button v-for="v in filteredVideos" :key="v.path" type="button" :data-path="v.path"
            class="group flex w-full min-w-0 items-start gap-3 rounded-2xl border border-linen bg-pure-white p-4 text-left transition-colors hover:border-charcoal-ink"
            @click="emit('play', v)">
            <span class="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-xl px-2 text-caption font-bold"
              :class="getVideoProgress(v.path)?.done ? 'bg-charcoal-ink text-pure-white' : getVideoProgress(v.path)?.ratio ? 'bg-sunbeam-yellow/40 text-charcoal-ink' : 'bg-page-cream text-stone'">
              <AppIcon v-if="getVideoProgress(v.path)?.done" name="check" :size="14" />
              <span v-else>{{ String(lessonNumber(v)).padStart(2, '0') }}</span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block whitespace-normal text-body-sm font-bold leading-relaxed text-charcoal-ink [overflow-wrap:anywhere] group-hover:text-deep-indigo" :title="v.title">{{ lessonTitle(v) }}</span>
              <span class="mt-2 flex flex-wrap items-start gap-x-3 gap-y-1 text-caption text-stone">
                <span v-if="getVideoProgress(v.path)?.done" class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink">已完成</span>
                <span v-else-if="getVideoProgress(v.path)?.ratio" class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink">已看 {{ Math.round((getVideoProgress(v.path)?.ratio ?? 0) * 100) }}%</span>
                <span v-else class="shrink-0 whitespace-nowrap">未学习</span>
                <span v-if="v.dir" class="min-w-0 basis-full leading-relaxed opacity-75 [overflow-wrap:anywhere]">{{ v.dir }}</span>
              </span>
            </span>
            <span class="mt-2 shrink-0 text-stone transition-transform group-hover:translate-x-0.5 group-hover:text-charcoal-ink"><AppIcon name="chevron-right" :size="16" /></span>
          </button>
        </div>

        <div v-if="!filteredVideos.length" class="py-12 text-center text-body-sm text-stone">未找到匹配的课节</div>
      </section>

      <!-- 辅助信息：打卡日历与近 7 天投入 -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section class="pane min-w-0 p-5 sm:p-6 lg:col-span-7" aria-label="学习打卡日历">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 class="text-subheading text-charcoal-ink">学习打卡</h3>
              <p class="mt-0.5 text-caption text-stone">{{ checkIn?.includesWork.value ? '看课与实践时间合计达到每日总投入后自动打卡' : guide.state.plan ? '达到每日学习目标后自动打卡' : '设置每日学习目标，记录学习进度' }}</p>
            </div>
            <UiButton size="sm" variant="ghost" @click="emit('guide', 'plan')">{{ guide.state.plan ? '调整计划时间' : '定制路线' }}</UiButton>
          </div>
          <CheckInCalendar @plan="emit('guide', 'plan')" />
        </section>
        <section class="pane min-w-0 p-5 sm:p-6 lg:col-span-5" aria-label="近 7 天投入">
          <h3 class="text-subheading text-charcoal-ink">近 7 天投入</h3>
          <p class="mt-0.5 text-caption text-stone">合计 {{ formatMinutes(week.total) }}，用于每周复盘。</p>
          <ol class="mt-4 space-y-2.5">
            <li v-for="row in week.rows" :key="row.date" class="grid grid-cols-[3rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-caption">
              <span class="tabular text-stone">{{ row.label }}</span>
              <span class="flex h-2.5 overflow-hidden rounded-full bg-linen" :title="`看课 ${row.video} 分钟 · 实践 ${row.work} 分钟`">
                <span class="h-full bg-charcoal-ink" :style="{ width: `${row.video / week.max * 100}%` }" />
                <span class="h-full bg-deep-indigo/60" :style="{ width: `${row.work / week.max * 100}%` }" />
              </span>
              <span class="tabular text-right" :class="row.checked ? 'font-bold text-charcoal-ink' : 'text-stone'">{{ row.video + row.work }} 分钟</span>
            </li>
          </ol>
          <p class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-caption text-stone">
            <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-charcoal-ink" />看课</span>
            <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-deep-indigo/60" />实践记录</span>
            <span>加粗为已打卡</span>
          </p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.course-lesson-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
}
</style>

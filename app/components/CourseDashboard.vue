<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import { useProgress } from '~/composables/useProgress'
import { useCheckIn } from '~/composables/useStudyCheckIn'
import AppIcon from '~/components/AppIcon.vue'
import CheckInCalendar from '~/components/CheckInCalendar.vue'
import DailyPracticeCard from '~/components/DailyPracticeCard.vue'
import StagePanel from '~/components/StagePanel.vue'
import StageProgressBars from '~/components/StageProgressBars.vue'
import TodayWorkList from '~/components/TodayWorkList.vue'
import UiButton from '~/components/UiButton.vue'
import PlanAdjustment from '~/components/PlanAdjustment.vue'
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
  const video = `剩余视频 ${formatStudyDuration(s.remainingSeconds)}${s.unknown ? `（含 ${s.unknown} 节估算时长）` : ''}`
  const program = guide.program.value
  if (!program) return { plan: '', video: `${video}，每日观看 ${formatMinutes(plan.dailyMinutes)}，预计 ${s.days} 天完成观看。` }
  const day = guide.planDay.value ?? 0
  const status = day < 1 ? `计划将于 ${program.startDate} 开始，共 ${program.days} 天` : day > program.days ? `计划周期（${program.days} 天）已结束` : `计划第 ${day} / ${program.days} 天`
  const finish = guide.videoFinish.value
  const finishText = finish === null ? '路线视频已全部观看' : finish === Infinity ? '当前未分配观看时间'
    : finish <= program.days ? `按阶段时间分配，预计第 ${finish} 天完成观看` : `预计第 ${finish} 天完成观看，超出计划 ${finish - program.days} 天`
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
  tasksOpen.value = false
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

// —— 近 7 天学习时长，便于周复盘 ——
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
function setModuleOpen(id: string, value: unknown) {
  if (value === 'content') openModules.add(id)
  else openModules.delete(id)
}
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
const tasksOpen = ref(false)
const catalogEl = ref<HTMLElement>()
const nextWork = computed(() => guide.todayWork.value.find(item => !item.done))
const workDone = computed(() => guide.todayWork.value.filter(item => item.done).length)
async function revealStage() {
  if (!activeModule.value) return
  openStage.value = activeModule.value.id
  openModules.add(activeModule.value.id)
  searchQuery.value = ''; filter.value = 'all'; guide.state.view = 'route'
  await nextTick()
  catalogEl.value?.querySelector(`[data-module="${CSS.escape(activeModule.value.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
</script>

<template>
  <div class="overview-page scroll-soft">
    <div class="overview-shell">
      <section class="overview-course-header pane p-5 sm:p-6" aria-label="课程概况">
        <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div class="min-w-0 flex-1 basis-80">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="line-clamp-2 text-heading-sm leading-snug [overflow-wrap:anywhere]" :title="course.name">{{ course.name }}</h1>
              <span v-if="timeSummary?.plan" class="rounded-full bg-sunbeam-yellow/30 px-2 py-1 text-caption font-bold">{{ timeSummary.plan }}</span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-stone">
              <span>{{ routeView ? '路线' : '共' }} {{ viewStats.total }} 节</span>
              <span>已完成 <strong class="text-charcoal-ink">{{ viewStats.done }}</strong> 节</span>
              <span>学习中 {{ viewStats.started }} 节</span>
              <span class="flex items-center gap-2"><span class="h-1.5 w-20 overflow-hidden rounded-full bg-linen"><span class="block h-full rounded-full bg-deep-indigo" :style="{ width: `${progressPercent}%` }" /></span>视频 {{ progressPercent }}%</span>
            </div>
          </div>
          <div class="flex min-w-0 flex-col gap-2 sm:items-end">
            <div class="flex flex-wrap gap-2">
              <UiButton v-if="resumeVideo" variant="dark" @click="startResume"><AppIcon name="play" :size="16" />{{ viewStats.done === viewStats.total ? '复习第一节' : viewStats.started || viewStats.done ? '继续学习' : '开始学习' }}</UiButton>
              <UiButton @click="emit('guide')"><AppIcon name="sparkles" :size="16" />{{ guide.state.plan ? '学习路线' : '定制路线' }}</UiButton>
              <PlanAdjustment />
            </div>
          </div>
        </div>
        <div v-if="timeSummary" class="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-linen pt-2 text-caption text-stone" aria-label="时间安排">
          <span v-if="guide.program.value" class="font-bold text-graphite">今日目标 {{ formatMinutes(guide.todayTotalMinutes.value ?? 0) }}<template v-if="guide.lightDay.value"> · 轻量复盘日</template></span>
          <span>{{ timeSummary.video }}</span>
          <button v-if="!guide.program.value" type="button" class="font-bold text-deep-indigo" @click="emit('guide', 'plan')">设置学习周期与时间分配</button>
        </div>
      </section>

      <div class="overview-summaries shrink-0">
        <section class="overview-summary pane min-w-0 p-5" aria-label="今日任务">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-body font-bold">今日任务 <span class="ml-1 text-caption font-normal text-stone">{{ guide.todayDate.value.slice(5) }}</span></h2>
            <UiButton size="sm" variant="text" @click="tasksOpen = true">查看任务 →</UiButton>
          </div>
          <ul v-if="allocation.length" class="overview-allocation mt-4 grid grid-cols-2 gap-x-6 gap-y-3" aria-label="今日时间分配">
            <li v-for="item in allocation" :key="item.key" class="min-w-0">
              <p class="text-caption text-stone">{{ item.label }}</p>
              <p class="mt-0.5 whitespace-nowrap text-caption tabular font-bold">{{ item.done }} / {{ item.target }}<span class="font-normal text-stone"> 分钟</span></p>
            </li>
          </ul>
          <div class="mt-5 flex items-center gap-3 border-t border-linen pt-4">
            <AppIcon name="play" :size="16" class="shrink-0 text-stone" />
            <div class="min-w-0 flex-1"><p class="truncate text-body-sm font-bold" :title="nextVideoItem ? `${itemTitle(nextVideoItem)} · ${formatStudyDuration(nextVideoItem.seconds)}` : ''"><span class="mr-2 text-caption font-normal text-stone">视频 {{ videoItems.filter(i => i.done).length }}/{{ videoItems.length }}</span>{{ nextVideoItem ? itemTitle(nextVideoItem) : guide.state.plan ? '暂无待学课节' : '尚未生成学习路线' }}</p></div>
            <UiButton v-if="nextVideoItem" size="sm" @click="startItem(nextVideoItem)">播放下一段</UiButton>
            <UiButton v-else-if="!guide.state.plan" size="sm" @click="emit('guide', 'plan')">定制路线</UiButton>
          </div>
          <div class="mt-3 flex items-center gap-3">
            <AppIcon name="note" :size="16" class="shrink-0 text-stone" />
            <div class="min-w-0 flex-1"><p class="truncate text-body-sm font-bold" :title="nextWork?.title"><span class="mr-2 text-caption font-normal text-stone">实践 {{ workDone }} / {{ guide.todayWork.value.length }} 项</span>{{ nextWork?.title ?? (guide.todayWork.value.length ? '今日已完成' : '暂无安排') }}</p></div>
            <UiButton v-if="guide.todayWork.value.length" size="sm" variant="text" @click="tasksOpen = true">记录实践</UiButton>
            <UiButton v-else size="sm" variant="text" @click="emit('guide', 'plan')">设置实践</UiButton>
          </div>
        </section>

        <DailyPracticeCard />
        <section class="overview-summary pane min-w-0 p-5" aria-label="阶段进度">
          <div class="mb-4 flex items-center justify-between gap-2"><h2 class="text-body font-bold">当前阶段</h2><UiButton v-if="activeModule" size="sm" variant="text" @click="revealStage">查看阶段验收</UiButton></div>
          <template v-if="guide.state.plan && activeModule">
            <VSelect aria-label="当前阶段" :model-value="guide.state.records.activeModuleId"
              :items="[{ value: '', title: guide.scheduledModule.value ? `按计划日期：${guide.scheduledModule.value.title}` : `按学习进度：${(guide.progressModule.value ?? activeModule).title}` }, ...stageOptions.map(m => ({ value: m.id, title: m.title }))]"
              @update:model-value="guide.setActiveModule($event ?? '')" />
            <p class="mt-4 line-clamp-2 text-body-sm leading-relaxed text-stone" :title="activeModule.practice?.goal ?? activeModule.description">{{ activeModule.practice?.goal ?? activeModule.description }}</p>
            <StageProgressBars v-if="activeProgress" class="overview-stage-progress mt-4" inline :progress="activeProgress" />
            <p v-if="stageLag" class="mt-2 text-caption text-deep-indigo">计划阶段与视频进度不同，可切换阶段或安排复盘。</p>
            <button v-if="guide.unresolvedQuestions.value.length" type="button" class="mt-2 text-caption font-bold text-deep-indigo" @click="emit('guide', 'help')">{{ guide.unresolvedQuestions.value.length }} 个待解决疑问 →</button>
          </template>
          <p v-else class="mt-3 text-body-sm leading-relaxed text-stone">尚未设置学习路线。</p>
        </section>

      </div>
      <section class="overview-history pane min-w-0 p-5" aria-label="学习打卡日历">
        <h2 class="mb-4 text-subheading font-bold">学习打卡</h2>
        <CheckInCalendar compact @plan="emit('guide', 'plan')" />
          <section class="mt-5 border-t border-linen pt-4" aria-label="近 7 天学习时长">
            <div class="flex justify-between gap-2 text-caption"><h3 class="font-bold">近 7 天学习时长</h3><span class="text-stone">合计 {{ formatMinutes(week.total) }}</span></div>
            <ol class="mt-1 grid grid-cols-7 gap-2">
              <li v-for="row in week.rows" :key="row.date" class="min-w-0 text-center" :title="`${row.date} · 视频 ${row.video} 分钟 · 实践 ${row.work} 分钟${row.checked ? ' · 已打卡' : ''}`">
                <div class="flex h-7 items-end justify-center" aria-hidden="true"><span class="flex w-full max-w-5 flex-col-reverse overflow-hidden rounded-sm bg-linen" :style="{ height: `${Math.max(2, (row.video + row.work) / week.max * 28)}px` }"><span class="bg-charcoal-ink" :style="{ height: `${row.video / Math.max(1, row.video + row.work) * 100}%` }" /><span class="bg-deep-indigo/60" :style="{ height: `${row.work / Math.max(1, row.video + row.work) * 100}%` }" /></span></div>
                <span class="mt-1 block text-[10px] tabular" :class="row.checked ? 'font-bold text-deep-indigo' : 'text-stone'">{{ row.label }}</span>
                <span class="sr-only">视频 {{ row.video }} 分钟，实践 {{ row.work }} 分钟{{ row.checked ? '，已打卡' : '' }}</span>
              </li>
            </ol>
          </section>
        <p class="mt-2 text-caption text-stone">深色：视频 · 紫色：实践</p>
      </section>
      <!-- 课程目录 / 学习路线 -->
      <section ref="catalogEl" class="overview-catalog pane min-w-0 p-5" aria-label="课程章节目录">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 class="text-subheading text-charcoal-ink">{{ routeView ? '学习路线' : '课程目录' }}</h3>
          </div>
          <div class="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <div class="w-full min-w-0 sm:w-64">
              <VTextField :model-value="searchQuery" type="search" label="搜索课节"
                density="compact" clearable @update:model-value="searchQuery = $event ?? ''">
                <template #prepend-inner><AppIcon name="search" :size="18" /></template>
              </VTextField>
            </div>
            <VBtnToggle v-model="filter" mandatory class="catalog-status" aria-label="按课程状态筛选">
              <VBtn value="all">全部 ({{ viewStats.total }})</VBtn>
              <VBtn value="unwatched">未完成 ({{ viewStats.total - viewStats.done }})</VBtn>
              <VBtn value="done">已完成 ({{ viewStats.done }})</VBtn>
            </VBtnToggle>
          </div>
        </div>

        <div v-if="guide.state.plan" class="mt-3 flex flex-wrap items-center gap-3">
          <div class="flex rounded-full bg-page-cream p-1" aria-label="概览目录视图">
            <button type="button" :aria-pressed="routeView" class="rounded-full px-4 py-1.5 text-caption font-bold" :class="routeView ? 'bg-charcoal-ink text-pure-white' : 'text-stone'" @click="guide.state.view = 'route'">定制路线</button>
            <button type="button" :aria-pressed="!routeView" class="rounded-full px-4 py-1.5 text-caption font-bold" :class="!routeView ? 'bg-pure-white' : 'text-stone'" @click="guide.state.view = 'all'">完整目录</button>
          </div>
          <label v-if="routeView" class="flex items-center gap-2 text-caption text-stone"><VCheckbox v-model="guide.state.includeOptional" class="shrink-0" />包含选修课</label>
          <button v-if="routeView && groups.length > 1 && !searching" type="button" class="text-caption font-bold hover:text-deep-indigo" @click="toggleAll">{{ allOpen ? '全部收起' : '全部展开' }}</button>
          <button v-if="guide.state.records.undo" type="button" class="ml-auto text-caption font-bold text-stone hover:text-deep-indigo" :disabled="!!guide.state.busy" @click="guide.undo()">撤销：{{ guide.state.records.undo.label }}</button>
        </div>
        <p v-if="guide.state.notice && guide.state.notice.startsWith('已撤销')" role="status" class="mt-3 text-caption text-stone">{{ guide.state.notice }}</p>

        <div class="overview-catalog-content scroll-soft mt-5">
        <!-- 路线视图：按阶段折叠 -->
        <div v-if="routeView" class="space-y-2">
          <section v-for="group in groups" :key="group.key" class="min-w-0" :data-module="group.moduleId" :aria-label="moduleTitles.get(group.moduleId) ?? '未分组课节'">
            <VExpansionPanels class="course-panels" :model-value="isOpen(group.moduleId) ? 'content' : undefined" :readonly="searching" @update:model-value="setModuleOpen(group.moduleId, $event)">
              <VExpansionPanel value="content">
                <VExpansionPanelTitle>
                  <span class="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-4">
                    <span class="flex flex-wrap items-center gap-2">
                      <span class="text-body-sm font-bold text-deep-indigo [overflow-wrap:anywhere]">{{ moduleTitles.get(group.moduleId) }}</span>
                      <span v-if="group.moduleId === activeModule?.id" class="rounded-full bg-sunbeam-yellow px-2 py-0.5 text-[11px] font-bold text-charcoal-ink">当前阶段</span>
                      <span v-if="guide.stageProgressMap.value.get(group.moduleId)?.complete" class="rounded-full bg-charcoal-ink px-2 py-0.5 text-[11px] font-bold text-pure-white">阶段完成</span>
                    </span>
                    <span class="mt-1 block text-caption font-normal text-stone sm:mt-0">
                      <template v-if="guide.moduleMap.value.get(group.moduleId)?.practice">第 {{ guide.moduleMap.value.get(group.moduleId)!.practice!.startDay }}–{{ guide.moduleMap.value.get(group.moduleId)!.practice!.endDay }} 天 · </template>
                      必修 {{ moduleStats.get(group.moduleId)?.total ?? group.videos.length }} 节 · 已完成 {{ moduleStats.get(group.moduleId)?.done ?? 0 }} 节
                      <template v-if="moduleStats.get(group.moduleId)?.seconds"> · 视频约 {{ formatStudyDuration(moduleStats.get(group.moduleId)!.seconds) }}</template>
                      <template v-if="guide.moduleMap.value.get(group.moduleId)?.practice?.checks.length"> · 验收 {{ (guide.stageProgressMap.value.get(group.moduleId)?.exercise.done ?? 0) + (guide.stageProgressMap.value.get(group.moduleId)?.project.done ?? 0) }}/{{ guide.moduleMap.value.get(group.moduleId)!.practice!.checks.length }}</template>
                    </span>
                  </span>
                </VExpansionPanelTitle>
                <VExpansionPanelText>
                  <VExpansionPanels v-if="guide.moduleMap.value.get(group.moduleId)" :model-value="openStage" class="stage-details mb-3" @update:model-value="openStage = $event ?? ''">
                    <VExpansionPanel :value="group.moduleId">
                      <VExpansionPanelTitle>{{ openStage === group.moduleId ? '收起阶段详情' : '阶段目标与验收' }}</VExpansionPanelTitle>
                      <VExpansionPanelText>
                        <StageProgressBars v-if="guide.stageProgressMap.value.get(group.moduleId)" class="mb-4" inline :progress="guide.stageProgressMap.value.get(group.moduleId)!" />
                        <StagePanel :module="guide.moduleMap.value.get(group.moduleId)!" />
                      </VExpansionPanelText>
                    </VExpansionPanel>
                  </VExpansionPanels>
                  <div class="course-lesson-grid grid items-stretch gap-3">
                    <button v-for="v in group.videos" :key="v.path" type="button" :data-path="v.path" :data-route-position="guide.routePositions.value.get(v.path)" :title="v.title"
                      class="group flex h-full w-full min-w-0 items-start gap-3 rounded-xl border border-linen bg-pure-white p-4 text-left transition-colors hover:border-charcoal-ink" @click="emit('play', v)">
                      <span class="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-xl px-2 text-caption font-bold"
                        :class="getVideoProgress(v.path)?.done ? 'bg-charcoal-ink text-pure-white' : getVideoProgress(v.path)?.ratio ? 'bg-sunbeam-yellow/40 text-charcoal-ink' : 'bg-page-cream text-stone'">
                        <AppIcon v-if="getVideoProgress(v.path)?.done" name="check" :size="14" />
                        <span v-else>{{ String(lessonNumber(v)).padStart(2, '0') }}</span>
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="line-clamp-2 text-body-sm font-bold leading-relaxed text-charcoal-ink [overflow-wrap:anywhere] group-hover:text-deep-indigo">{{ lessonTitle(v) }}</span>
                        <span class="mt-1.5 flex flex-wrap items-start gap-x-3 gap-y-1 text-caption text-stone">
                          <span v-if="getVideoProgress(v.path)?.done" class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink">已完成</span>
                          <span v-else-if="getVideoProgress(v.path)?.ratio" class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink">已观看 {{ Math.round((getVideoProgress(v.path)?.ratio ?? 0) * 100) }}%</span>
                          <span v-else class="shrink-0 whitespace-nowrap">未学习</span>
                          <span v-if="v.dir" class="min-w-0 [overflow-wrap:anywhere]">{{ conciseSource(v.dir) }}</span>
                        </span>
                      </span>
                      <span class="mt-2 shrink-0 text-stone transition-transform group-hover:translate-x-0.5 group-hover:text-charcoal-ink"><AppIcon name="chevron-right" :size="16" /></span>
                    </button>
                  </div>
                </VExpansionPanelText>
              </VExpansionPanel>
            </VExpansionPanels>
          </section>
        </div>

        <!-- 完整目录 -->
        <div v-else class="course-lesson-grid grid gap-3">
          <button v-for="v in filteredVideos" :key="v.path" type="button" :data-path="v.path"
            class="group flex h-full w-full min-w-0 items-start gap-3 rounded-xl border border-linen bg-pure-white p-4 text-left transition-colors hover:border-charcoal-ink"
            @click="emit('play', v)">
            <span class="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-xl px-2 text-caption font-bold"
              :class="getVideoProgress(v.path)?.done ? 'bg-charcoal-ink text-pure-white' : getVideoProgress(v.path)?.ratio ? 'bg-sunbeam-yellow/40 text-charcoal-ink' : 'bg-page-cream text-stone'">
              <AppIcon v-if="getVideoProgress(v.path)?.done" name="check" :size="14" />
              <span v-else>{{ String(lessonNumber(v)).padStart(2, '0') }}</span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="line-clamp-2 text-body-sm font-bold leading-relaxed text-charcoal-ink [overflow-wrap:anywhere] group-hover:text-deep-indigo" :title="v.title">{{ lessonTitle(v) }}</span>
              <span class="mt-2 flex flex-wrap items-start gap-x-3 gap-y-1 text-caption text-stone">
                <span v-if="getVideoProgress(v.path)?.done" class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink">已完成</span>
                <span v-else-if="getVideoProgress(v.path)?.ratio" class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink">已观看 {{ Math.round((getVideoProgress(v.path)?.ratio ?? 0) * 100) }}%</span>
                <span v-else class="shrink-0 whitespace-nowrap">未学习</span>
                <span v-if="v.dir" class="min-w-0 basis-full leading-relaxed opacity-75 [overflow-wrap:anywhere]">{{ v.dir }}</span>
              </span>
            </span>
            <span class="mt-2 shrink-0 text-stone transition-transform group-hover:translate-x-0.5 group-hover:text-charcoal-ink"><AppIcon name="chevron-right" :size="16" /></span>
          </button>
        </div>

        <div v-if="!filteredVideos.length" class="py-12 text-center text-body-sm text-stone">未找到匹配的课节</div>
        </div>
      </section>


    </div>
    <VDialog v-model="tasksOpen" max-width="880" aria-label="今日任务明细">
      <div class="paper-dialog flex min-h-0 flex-col">
        <header class="flex shrink-0 items-center justify-between border-b border-linen px-5 py-3"><h2 class="text-subheading">今日任务</h2><div class="flex gap-2"><UiButton size="sm" variant="text" @click="tasksOpen = false; emit('guide', 'today')">调整安排</UiButton><UiButton size="sm" icon title="关闭今日任务" @click="tasksOpen = false"><AppIcon name="close" :size="18" /></UiButton></div></header>
        <div class="scroll-soft min-h-0 overflow-y-auto p-5">
          <h3 class="text-body font-bold">视频学习</h3>
              <ul v-if="videoItems.length" class="mt-2 space-y-2">
                <li v-for="item in videoItems" :key="item.id" class="flex items-start gap-3 rounded-xl border border-linen bg-pure-white p-3">
                  <VCheckbox :model-value="item.done" class="shrink-0" :aria-label="`完成：${itemTitle(item)}`"
                    @update:model-value="guide.completeTodayItem(item.id, !!$event)" />
                  <div class="min-w-0 flex-1">
                    <button type="button" class="block max-w-full text-left text-body-sm font-bold text-charcoal-ink [overflow-wrap:anywhere] hover:text-deep-indigo"
                      :class="item.done ? 'text-stone line-through' : ''" @click="startItem(item)">{{ itemTitle(item) }}</button>
                    <p class="mt-1 text-caption text-stone">{{ item.kind === 'question' ? '处理疑问' : item.kind === 'review' ? '补学基础' : '学习片段' }} · {{ formatStudyDuration(item.seconds) }}{{ item.estimated ? '（估算）' : '' }}</p>
                  </div>
                </li>
              </ul>
              <p v-else class="mt-2 rounded-xl border border-linen bg-pure-white p-3 text-caption text-stone">
                {{ !guide.state.plan ? '尚未生成学习路线。' : guide.lightDay.value || guide.todayBudget.value?.video === 0 ? '今日未安排视频学习。' : '暂无待学课节。' }}
              </p>

          <h3 class="mt-5 text-body font-bold">实践任务</h3>
          <TodayWorkList v-if="guide.todayWork.value.length" class="mt-3" />
          <p v-else class="mt-2 text-body-sm text-stone">今日暂无实践任务，可在“定制路线”中设置。</p>
        </div>
      </div>
    </VDialog>
  </div>
</template>

<style scoped>
.overview-page { position: relative; flex: 1; min-height: 0; overflow-y: auto; padding: 24px; background: var(--color-page-cream); }
.overview-shell { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 24px; max-width: 1440px; margin-inline: auto; }
.overview-summaries { display: grid; grid-template-columns: minmax(0, 1fr); align-items: stretch; gap: 24px; }
.overview-summary { container-type: inline-size; }
.overview-stage-progress { grid-template-columns: minmax(0, 1fr); }
@container (min-width: 22rem) {
  .overview-stage-progress { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@container (min-width: 24rem) {
  .overview-allocation { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.overview-catalog-content { max-height: min(70vh, 760px); overflow-y: auto; overscroll-behavior: contain; }
.course-lesson-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); }
.catalog-status { height: 40px; padding: 3px; border: 1px solid var(--color-linen); border-radius: 8px; }
.catalog-status :deep(.v-btn) { height: 32px; min-width: 0; padding-inline: 12px; font-size: 12px; }
.catalog-status :deep(.v-btn--active) { background: var(--color-charcoal-ink); color: white; }
.stage-details :deep(.v-expansion-panel-title) { min-height: 40px; padding-block: 8px; }
@media (min-width: 1100px) {
  .overview-shell { grid-template-columns: minmax(0, 1fr) 360px; }
  .overview-course-header { grid-column: 1 / -1; }
  .overview-summaries { grid-column: 2; grid-row: 2; }
  /* 宽屏时目录不参与行高计算，拉伸至与右侧栏等高，课节在内部滚动。 */
  .overview-catalog { grid-column: 1; grid-row: 2 / 4; align-self: stretch; display: flex; flex-direction: column; contain: size; min-height: 30rem; }
  .overview-catalog-content { flex: 1 1 0; min-height: 0; max-height: none; }
  .overview-history { grid-column: 2; grid-row: 3; }
}
@media (max-width: 639px) {
  .overview-page { padding: 16px; }
  .overview-shell, .overview-summaries { gap: 20px; }
}
</style>

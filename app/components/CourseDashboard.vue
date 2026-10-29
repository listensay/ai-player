<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import { useProgress } from '~/composables/useProgress'
import { useCheckIn } from '~/composables/useStudyCheckIn'
import AppIcon from '~/components/AppIcon.vue'
import CheckInCalendar from '~/components/CheckInCalendar.vue'
import StagePanel from '~/components/StagePanel.vue'
import StageProgressBars from '~/components/StageProgressBars.vue'
import TodayWorkList from '~/components/TodayWorkList.vue'
import UiButton from '~/components/UiButton.vue'
import PlanAdjustment from '~/components/PlanAdjustment.vue'
import CourseCatalogBranch from '~/components/CourseCatalogBranch.vue'
import { catalogFolderPaths, catalogLocation, filterCourseCatalog } from '~/utils/courseCatalog'
import type { Course, VideoEntry } from '~/types/course'
import type { TodayItem } from '~/types/guide'
import { formatStudyDuration } from '~/utils/guide'
import { BUDGET_LABELS, WORK_KINDS, conciseLessonTitle, conciseSource, formatMinutes } from '~/utils/studyProgram'

const props = defineProps<{
  course: Course
  stats: { total: number; done: number; started: number }
  currentVideo: VideoEntry | null
}>()

const emit = defineEmits<{
  play: [video: VideoEntry]
  segment: [item: TodayItem]
  guide: [tab?: 'plan' | 'today' | 'settings']
}>()

const progress = useProgress()
const guide = useGuide()
const checkIn = useCheckIn()

const searchQuery = ref('')
const filter = ref<'all' | 'unwatched' | 'done'>('all')
const routeView = guide.routeView
const displayedVideos = computed(() => (routeView.value ? guide.routeVideos.value : props.course.videos))
const moduleTitles = computed(() => new Map(guide.state.plan?.modules.map((m) => [m.id, m.title]) ?? []))
function routeModule(path: string) {
  return guide.lessonMap.value.get(path)?.moduleId
}
function lessonNumber(v: VideoEntry) {
  return routeView.value ? guide.routePositions.value.get(v.path) : v.index + 1
}
/** 路线视图使用精简标题，序号前缀和课程系列名由阶段分组与来源说明承担。 */
function lessonTitle(v: VideoEntry) {
  return routeView.value ? conciseLessonTitle(v.title) : v.title
}

const courseProgressMap = computed(() => progress.courseProgress(props.course.id))
const viewStats = computed(() =>
  routeView.value
    ? {
        total: displayedVideos.value.length,
        done: displayedVideos.value.filter((v) => courseProgressMap.value[v.path]?.done).length,
        started: displayedVideos.value.filter((v) => {
          const p = courseProgressMap.value[v.path]
          return p && !p.done && p.ratio > 0
        }).length,
      }
    : props.stats,
)

const resumeVideo = computed(() => {
  if (routeView.value)
    return guide.firstLesson.value ? (guide.videoMap.value.get(guide.firstLesson.value.path) ?? null) : null
  if (props.currentVideo && !courseProgressMap.value[props.currentVideo.path]?.done) return props.currentVideo
  const inProgress = props.course.videos.find((v) => {
    const p = courseProgressMap.value[v.path]
    return p && !p.done && p.ratio > 0
  })
  if (inProgress) return inProgress
  return props.course.videos.find((v) => !courseProgressMap.value[v.path]?.done) ?? props.course.videos[0] ?? null
})

const progressPercent = computed(() =>
  viewStats.value.total ? Math.min(100, Math.round((viewStats.value.done / viewStats.value.total) * 100)) : 0,
)

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
function getVideoProgress(path: string) {
  return courseProgressMap.value[path]
}
function startResume() {
  if (resumeVideo.value) emit('play', resumeVideo.value)
}

// —— 时间口径：完整计划与视频排期分开说明 ——
const timeSummary = computed(() => {
  const plan = guide.state.plan
  if (!plan) return null
  const s = guide.schedule.value
  const video = `剩余视频 ${formatStudyDuration(s.remainingSeconds)}${s.unknown ? `（含 ${s.unknown} 节估算时长）` : ''}`
  const program = guide.program.value
  if (!program)
    return { plan: '', video: `${video}，每日观看 ${formatMinutes(plan.dailyMinutes)}，预计 ${s.days} 天完成观看。` }
  const day = guide.planDay.value ?? 0
  const status =
    day < 1
      ? `计划将于 ${program.startDate} 开始，共 ${program.days} 天`
      : day > program.days
        ? `计划周期（${program.days} 天）已结束`
        : `计划第 ${day} / ${program.days} 天`
  const finish = guide.videoFinish.value
  const finishText =
    finish === null
      ? '路线视频已全部观看'
      : finish === Infinity
        ? '当前未分配观看时间'
        : finish <= program.days
          ? `按阶段时间分配，预计第 ${finish} 天完成观看`
          : `预计第 ${finish} 天完成观看，超出计划 ${finish - program.days} 天`
  return { plan: status, video: `${video}，${finishText}。` }
})

// —— 今日任务：看课 + 独立编码 + 项目实践 + 复习 ——
const todayVideoSeconds = computed(() => checkIn?.state.days[checkIn.state.date]?.seconds ?? 0)
const allocation = computed(() => {
  const budget = guide.todayBudget.value
  if (!budget) return []
  const work = Object.fromEntries(
    WORK_KINDS.map((k) => [k, guide.todayWork.value.filter((e) => e.kind === k).reduce((n, e) => n + e.minutes, 0)]),
  )
  return (['video', ...WORK_KINDS] as const)
    .map((key) => ({
      key,
      label: BUDGET_LABELS[key],
      target: budget[key],
      done: key === 'video' ? Math.floor(todayVideoSeconds.value / 60) : (work[key] ?? 0),
    }))
    .filter((item) => item.target > 0 || item.done > 0)
})
const videoItems = computed(() => guide.state.today?.items ?? [])
function itemTitle(item: TodayItem) {
  const video = guide.videoMap.value.get(item.path)
  return video ? conciseLessonTitle(video.title) : item.path
}
function startItem(item: TodayItem) {
  tasksOpen.value = false
  emit('segment', item)
}
const stageOptions = computed(() => {
  const ids = new Set(guide.route.value.map((l) => l.moduleId))
  return (guide.state.plan?.modules ?? []).filter((m) => m.practice || ids.has(m.id))
})
const activeModule = guide.activeModule
const stageLag = computed(() => {
  const scheduled = guide.scheduledModule.value,
    current = guide.progressModule.value
  return scheduled && current && scheduled.id !== current.id ? { scheduled, current } : null
})
const activeProgress = computed(() =>
  activeModule.value ? guide.stageProgressMap.value.get(activeModule.value.id) : undefined,
)

// Keep consecutive route segments in order, including returns to an earlier stage.
const openGroups = reactive(new Set<string>())
const groupPages = reactive<Record<string, number>>({})
const openFolders = reactive(new Set<string>())
const folderPages = reactive<Record<string, number>>({})
const pageSize = 12
const searching = computed(() => !!searchQuery.value.trim() || filter.value !== 'all')
const groups = computed(() => {
  const result: Array<{ key: string; moduleId: string; occurrence: number; videos: VideoEntry[] }> = []
  const occurrences = new Map<string, number>()
  for (const v of filteredVideos.value) {
    const id = routeModule(v.path) ?? ''
    const last = result.at(-1)
    if (last?.moduleId === id) last.videos.push(v)
    else {
      const occurrence = (occurrences.get(id) ?? 0) + 1
      occurrences.set(id, occurrence)
      result.push({ key: `${id}:${v.path}`, moduleId: id, occurrence, videos: [v] })
    }
  }
  return result.map((group) => {
    const pages = Math.max(1, Math.ceil(group.videos.length / pageSize))
    const page = Math.min(groupPages[group.key] ?? 1, pages)
    return {
      ...group,
      page,
      pages,
      done: group.videos.filter((v) => courseProgressMap.value[v.path]?.done).length,
      visible: group.videos.slice((page - 1) * pageSize, page * pageSize),
    }
  })
})
const catalogRoot = computed(() =>
  filterCourseCatalog(
    props.course.root,
    new Set(filteredVideos.value.map((video) => video.path)),
    courseProgressMap.value,
  ),
)
const folderPaths = computed(() => catalogFolderPaths(catalogRoot.value))
watch([searchQuery, filter, routeView, () => guide.state.includeOptional], () => {
  for (const key of Object.keys(folderPages)) delete folderPages[key]
  for (const key of Object.keys(groupPages)) delete groupPages[key]
})
watch(
  () => props.course.id,
  () => {
    openFolders.clear()
    for (const key of Object.keys(folderPages)) delete folderPages[key]
  },
)
const allOpen = computed(() =>
  routeView.value
    ? groups.value.every((g) => openGroups.has(g.key))
    : folderPaths.value.every((path) => openFolders.has(path)),
)
function isOpen(key: string) {
  return searching.value || openGroups.has(key)
}
function setGroupOpen(key: string, value: unknown) {
  if (value === 'content') openGroups.add(key)
  else openGroups.delete(key)
}
function toggleAll() {
  if (!routeView.value) {
    if (allOpen.value) openFolders.clear()
    else for (const path of folderPaths.value) openFolders.add(path)
    return
  }
  if (allOpen.value) openGroups.clear()
  else for (const g of groups.value) openGroups.add(g.key)
}
function setFolderOpen(path: string, open: boolean) {
  if (open) openFolders.add(path)
  else openFolders.delete(path)
}

// Follow the same unfinished lesson as “continue learning”; completed courses stay at the last viewed lesson.
const progressVideo = computed(() => {
  if (viewStats.value.total && viewStats.value.done === viewStats.value.total)
    return (
      displayedVideos.value.find((video) => video.path === props.currentVideo?.path) ?? displayedVideos.value.at(-1)
    )
  return resumeVideo.value
})
const progressTarget = computed(() => {
  const path = progressVideo.value?.path
  if (!path || !guide.guideReady.value || !progress.state.ready || searching.value) return null
  if (!routeView.value) {
    const folders = catalogLocation(catalogRoot.value, path, pageSize)
    return folders ? { path, folders, groupKey: undefined, page: 1 } : null
  }
  const group = routeView.value
    ? groups.value.find((entry) => entry.videos.some((video) => video.path === path))
    : undefined
  const index = (routeView.value ? (group?.videos ?? []) : filteredVideos.value).findIndex(
    (video) => video.path === path,
  )
  return index < 0 ? null : { path, groupKey: group?.key, page: Math.floor(index / pageSize) + 1 }
})
const catalogViewport = ref<HTMLElement>()
let revealRevision = 0
let revealFrame: number | undefined
function cancelReveal() {
  revealRevision++
}
async function revealLesson(path: string) {
  const revision = ++revealRevision
  await nextTick()
  if (revision !== revealRevision || !catalogViewport.value) return
  await new Promise<void>((resolve) => {
    revealFrame = requestAnimationFrame(() => {
      revealFrame = undefined
      resolve()
    })
  })
  if (revision !== revealRevision) return
  const viewport = catalogViewport.value
  const lesson = viewport?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
  if (!viewport || !lesson) return
  // Wait for the UI expansion to finish before measuring the final page height.
  const animations: Animation[] = []
  for (
    let panel = lesson.closest('.v-expansion-panel-text');
    panel;
    panel = panel.parentElement?.closest('.v-expansion-panel-text') ?? null
  )
    animations.push(...panel.getAnimations())
  await Promise.allSettled(animations.map((animation) => animation.finished))
  if (revision !== revealRevision || !lesson.isConnected || !viewport.clientHeight) return
  const bounds = lesson.getBoundingClientRect(),
    frame = viewport.getBoundingClientRect()
  const top = bounds.top - frame.top - viewport.clientTop
  const bottom = top + bounds.height
  if (top < 16 || bottom > viewport.clientHeight - 16)
    viewport.scrollTo({
      top: Math.max(0, viewport.scrollTop + top - (viewport.clientHeight - bounds.height) / 2),
      behavior: 'auto',
    })
}
watch(
  () =>
    progressTarget.value
      ? JSON.stringify([props.course.id, routeView.value, guide.state.includeOptional, progressTarget.value])
      : '',
  () => {
    cancelReveal()
    const target = progressTarget.value
    if (!target) return
    if (target.groupKey) {
      openGroups.add(target.groupKey)
      groupPages[target.groupKey] = target.page
    } else if (target.folders) {
      for (const location of target.folders) {
        if (location.folder) openFolders.add(location.folder)
        folderPages[location.folder] = location.page
      }
    }
    void revealLesson(target.path)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  cancelReveal()
  if (revealFrame !== undefined) cancelAnimationFrame(revealFrame)
})
const openStage = ref('')
const tasksOpen = ref(false),
  planOpen = ref(false),
  stageOpen = ref(false),
  historyOpen = ref(false)
const workDone = computed(() => guide.todayWork.value.filter((item) => item.done).length)
</script>

<template>
  <div
    ref="catalogViewport"
    class="overview-page scroll-soft"
    @wheel.passive="cancelReveal"
    @touchmove.passive="cancelReveal"
    @pointerdown="cancelReveal"
    @keydown="cancelReveal"
  >
    <div class="overview-shell">
      <section class="overview-course-header pane rounded-3xl p-6 sm:p-8" aria-label="课程概况">
        <div class="flex flex-col gap-5 sm:gap-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center gap-1.5 rounded-full bg-page-cream px-3 py-1 text-caption font-bold text-charcoal-ink"
              >
                <span class="h-2 w-2 rounded-full bg-brand-orange" aria-hidden="true" />
                课程概览
              </span>
              <span
                v-if="timeSummary?.plan"
                class="rounded-full border border-linen bg-pure-white px-3 py-1 text-caption font-medium text-stone"
              >
                {{ timeSummary.plan }}
              </span>
            </div>
            <div class="overview-course-actions flex flex-wrap items-center gap-2">
              <UiButton
                variant="ghost"
                size="sm"
                class="border border-linen hover:border-charcoal-ink/30"
                @click="planOpen = true"
              >
                学习计划
              </UiButton>
            </div>
          </div>

          <div>
            <h1 class="text-heading font-bold tracking-tight text-charcoal-ink [overflow-wrap:anywhere]">
              {{ course.name }}
            </h1>
            <p v-if="timeSummary?.video" class="mt-2 text-body-sm text-stone leading-relaxed">
              {{ timeSummary.video }}
            </p>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-4 border-t border-linen/70 pt-5">
            <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-body-sm text-stone">
              <span
                >已看完 <strong class="text-charcoal-ink font-bold">{{ viewStats.done }}</strong> /
                {{ viewStats.total }} 节</span
              >
              <div class="flex items-center gap-3">
                <div
                  class="h-2 w-32 sm:w-48 overflow-hidden rounded-full bg-linen"
                  role="progressbar"
                  aria-label="视频观看进度"
                  :aria-valuenow="progressPercent"
                  :aria-valuemin="0"
                  :aria-valuemax="100"
                >
                  <div
                    class="h-full rounded-full bg-deep-indigo transition-all duration-300"
                    :style="{ width: `${progressPercent}%` }"
                  />
                </div>
                <span class="text-caption tabular font-bold text-charcoal-ink">{{ progressPercent }}%</span>
              </div>
            </div>
            <UiButton v-if="resumeVideo" variant="dark" class="shadow-subtle rounded-full px-6" @click="startResume">
              <AppIcon name="play" :size="17" />
              {{
                viewStats.done === viewStats.total
                  ? '复习第一节'
                  : viewStats.started || viewStats.done
                    ? '继续学习'
                    : '开始学习'
              }}
            </UiButton>
          </div>
        </div>
      </section>

      <!-- 课程目录 / 学习路线 -->
      <section class="overview-catalog pane min-w-0 rounded-3xl p-6 sm:p-8" aria-label="课程章节目录">
        <div class="flex flex-wrap items-center justify-between gap-4 border-b border-linen/70 pb-5">
          <div class="flex items-center gap-2.5">
            <h2 class="text-heading-sm font-bold text-charcoal-ink">{{ routeView ? '学习路线' : '课程目录' }}</h2>
            <span class="rounded-full bg-page-cream px-2.5 py-0.5 text-caption font-bold text-stone">
              {{ displayedVideos.length }} 节
            </span>
          </div>
          <div v-if="guide.state.plan" class="flex rounded-full bg-page-cream p-1" aria-label="概览目录视图">
            <button
              type="button"
              :aria-pressed="routeView"
              class="rounded-full px-3.5 py-1.5 text-caption font-bold transition-colors"
              :class="routeView ? 'bg-charcoal-ink text-pure-white shadow-xs' : 'text-stone hover:text-charcoal-ink'"
              @click="guide.state.view = 'route'"
            >
              定制路线
            </button>
            <button
              type="button"
              :aria-pressed="!routeView"
              class="rounded-full px-3.5 py-1.5 text-caption font-bold transition-colors"
              :class="!routeView ? 'bg-charcoal-ink text-pure-white shadow-xs' : 'text-stone hover:text-charcoal-ink'"
              @click="guide.state.view = 'all'"
            >
              完整目录
            </button>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap items-center gap-3">
          <VTextField
            :model-value="searchQuery"
            type="search"
            label="搜索课节"
            class="min-w-0 flex-1 basis-52"
            density="compact"
            clearable
            hide-details
            @update:model-value="searchQuery = $event ?? ''"
          >
            <template #prepend-inner><AppIcon name="search" :size="17" class="text-stone" /></template>
          </VTextField>

          <div class="flex items-center gap-1 rounded-full bg-page-cream p-1" role="radiogroup" aria-label="学习状态">
            <button
              type="button"
              role="radio"
              :aria-checked="filter === 'all'"
              class="rounded-full px-3 py-1.5 text-caption font-bold transition-colors"
              :class="
                filter === 'all' ? 'bg-charcoal-ink text-pure-white shadow-xs' : 'text-stone hover:text-charcoal-ink'
              "
              @click="filter = 'all'"
            >
              全部
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="filter === 'unwatched'"
              class="rounded-full px-3 py-1.5 text-caption font-bold transition-colors"
              :class="
                filter === 'unwatched'
                  ? 'bg-charcoal-ink text-pure-white shadow-xs'
                  : 'text-stone hover:text-charcoal-ink'
              "
              @click="filter = 'unwatched'"
            >
              未完成
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="filter === 'done'"
              class="rounded-full px-3 py-1.5 text-caption font-bold transition-colors"
              :class="
                filter === 'done' ? 'bg-charcoal-ink text-pure-white shadow-xs' : 'text-stone hover:text-charcoal-ink'
              "
              @click="filter = 'done'"
            >
              已完成
            </button>
          </div>

          <VMenu>
            <template #activator="{ props: menuProps }">
              <UiButton v-bind="menuProps" icon variant="ghost" size="sm" class="border border-linen" title="目录选项">
                <AppIcon name="menu" :size="17" />
              </UiButton>
            </template>
            <VList>
              <VListItem v-if="routeView">
                <VCheckbox v-model="guide.state.includeOptional" label="包含选修课" />
              </VListItem>
              <VListItem
                v-if="(routeView ? groups.length > 1 : folderPaths.length > 0) && !searching"
                :title="allOpen ? '全部收起' : '全部展开'"
                @click="toggleAll"
              />
              <VListItem
                v-if="guide.state.records.undo && !guide.state.records.undo.scheduleOnly"
                :title="`撤销：${guide.state.records.undo.label}`"
                :disabled="!!guide.state.busy"
                @click="guide.undo()"
              />
              <VListItem title="学习路线设置" @click="emit('guide', 'plan')" />
            </VList>
          </VMenu>
        </div>

        <p
          v-if="guide.state.notice && guide.state.notice.startsWith('已撤销')"
          role="status"
          class="mt-3 text-caption text-stone"
        >
          {{ guide.state.notice }}
        </p>

        <div class="overview-catalog-content mt-6">
          <!-- 路线视图：按阶段折叠 -->
          <div v-if="routeView" class="space-y-4">
            <section
              v-for="group in groups"
              :key="group.key"
              class="min-w-0"
              :data-module="group.moduleId"
              :aria-label="moduleTitles.get(group.moduleId) ?? '未分组课节'"
            >
              <VExpansionPanels
                class="course-panels"
                :model-value="isOpen(group.key) ? 'content' : undefined"
                :readonly="searching"
                @update:model-value="setGroupOpen(group.key, $event)"
              >
                <VExpansionPanel value="content">
                  <VExpansionPanelTitle>
                    <span class="min-w-0 flex-1 py-1 pr-3">
                      <span class="flex flex-wrap items-center gap-2">
                        <span class="text-body font-bold leading-relaxed text-charcoal-ink [overflow-wrap:anywhere]">{{
                          moduleTitles.get(group.moduleId) ?? '未分组课节'
                        }}</span>
                        <span
                          v-if="group.occurrence > 1"
                          class="rounded-full bg-page-cream px-2 py-0.5 text-caption font-bold text-stone"
                          >接续</span
                        >
                        <span
                          v-if="group.key === progressTarget?.groupKey"
                          class="rounded-full bg-sunbeam-yellow/40 px-2 py-0.5 text-[11px] font-bold text-charcoal-ink"
                        >
                          当前阶段
                        </span>
                        <span
                          v-if="guide.stageProgressMap.value.get(group.moduleId)?.complete"
                          class="rounded-full bg-deep-indigo/10 px-2 py-0.5 text-caption font-bold text-deep-indigo"
                        >
                          阶段完成
                        </span>
                      </span>
                      <span class="mt-2 block text-caption font-normal text-stone">
                        <template v-if="searching">匹配 {{ group.videos.length }} 节</template>
                        <template v-else
                          >第 {{ lessonNumber(group.videos[0]!) }}–{{
                            lessonNumber(group.videos[group.videos.length - 1]!)
                          }}
                          节</template
                        >
                        <span class="mx-2.5">·</span>已看 {{ group.done }} / {{ group.videos.length }} 节
                      </span>
                    </span>
                  </VExpansionPanelTitle>
                  <VExpansionPanelText>
                    <VExpansionPanels
                      v-if="guide.moduleMap.value.get(group.moduleId)"
                      :model-value="openStage"
                      class="stage-details mb-4"
                      @update:model-value="openStage = $event ?? ''"
                    >
                      <VExpansionPanel :value="group.moduleId">
                        <VExpansionPanelTitle>{{
                          openStage === group.moduleId ? '收起阶段详情' : '阶段目标与验收'
                        }}</VExpansionPanelTitle>
                        <VExpansionPanelText>
                          <StageProgressBars
                            v-if="guide.stageProgressMap.value.get(group.moduleId)"
                            class="mb-4"
                            inline
                            :progress="guide.stageProgressMap.value.get(group.moduleId)!"
                          />
                          <StagePanel :module="guide.moduleMap.value.get(group.moduleId)!" />
                        </VExpansionPanelText>
                      </VExpansionPanel>
                    </VExpansionPanels>
                    <div class="course-lesson-grid grid items-stretch gap-4">
                      <button
                        v-for="v in group.visible"
                        :key="v.path"
                        type="button"
                        :data-path="v.path"
                        :data-route-position="guide.routePositions.value.get(v.path)"
                        :aria-current="v.path === progressVideo?.path ? 'step' : undefined"
                        :class="{ 'overview-current-lesson': v.path === progressVideo?.path }"
                        :title="v.title"
                        class="group flex h-full w-full min-w-0 items-start gap-3.5 rounded-2xl border border-linen bg-pure-white p-4 text-left transition-all duration-150 hover:border-charcoal-ink hover:shadow-xs"
                        @click="emit('play', v)"
                      >
                        <span
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-caption font-bold"
                          :class="
                            getVideoProgress(v.path)?.done
                              ? 'bg-charcoal-ink text-pure-white'
                              : getVideoProgress(v.path)?.ratio
                                ? 'bg-sunbeam-yellow/40 text-charcoal-ink'
                                : 'bg-page-cream text-stone'
                          "
                        >
                          <AppIcon v-if="getVideoProgress(v.path)?.done" name="check" :size="14" />
                          <span v-else>{{ String(lessonNumber(v)).padStart(2, '0') }}</span>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span
                            class="line-clamp-2 text-body-sm font-bold leading-snug text-charcoal-ink [overflow-wrap:anywhere] group-hover:text-deep-indigo"
                          >
                            {{ lessonTitle(v) }}
                          </span>
                          <span class="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-stone">
                            <span
                              v-if="v.path === progressVideo?.path"
                              class="rounded-full bg-deep-indigo/10 px-2 py-0.5 text-[11px] font-bold text-deep-indigo"
                            >
                              当前课节
                            </span>
                            <span
                              v-if="getVideoProgress(v.path)?.done"
                              class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink"
                            >
                              已完成
                            </span>
                            <span
                              v-else-if="getVideoProgress(v.path)?.ratio"
                              class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink"
                            >
                              已看 {{ Math.round((getVideoProgress(v.path)?.ratio ?? 0) * 100) }}%
                            </span>

                            <span v-if="v.dir" class="min-w-0 truncate text-[11px]" :title="v.dir">{{
                              conciseSource(v.dir)
                            }}</span>
                          </span>
                        </span>
                        <span
                          class="mt-1 shrink-0 text-stone transition-transform duration-150 group-hover:translate-x-1 group-hover:text-charcoal-ink"
                        >
                          <AppIcon name="chevron-right" :size="16" />
                        </span>
                      </button>
                    </div>
                    <nav
                      v-if="group.pages > 1"
                      class="mt-5 flex items-center justify-end gap-3"
                      :aria-label="`${moduleTitles.get(group.moduleId)}课节分页`"
                    >
                      <UiButton size="sm" :disabled="group.page === 1" @click="groupPages[group.key] = group.page - 1">
                        上一页
                      </UiButton>
                      <span class="text-caption tabular font-medium text-stone"
                        >{{ group.page }} / {{ group.pages }}</span
                      >
                      <UiButton
                        size="sm"
                        :disabled="group.page === group.pages"
                        @click="groupPages[group.key] = group.page + 1"
                      >
                        下一页
                      </UiButton>
                    </nav>
                  </VExpansionPanelText>
                </VExpansionPanel>
              </VExpansionPanels>
            </section>
          </div>

          <!-- 完整目录：按原文件夹层级展开 -->
          <CourseCatalogBranch
            v-else
            :folder="catalogRoot"
            :expanded="openFolders"
            :pages="folderPages"
            :page-size="pageSize"
            :filtering="searching"
            @toggle="setFolderOpen"
            @page="(path, page) => (folderPages[path] = page)"
          >
            <template #video="{ video: v }">
              <button
                type="button"
                :data-path="v.path"
                :aria-current="v.path === progressVideo?.path ? 'step' : undefined"
                :class="{ 'overview-current-lesson': v.path === progressVideo?.path }"
                class="group flex h-full w-full min-w-0 items-start gap-3.5 rounded-2xl border border-linen bg-pure-white p-4 text-left transition-all duration-150 hover:border-charcoal-ink hover:shadow-xs"
                @click="emit('play', v)"
              >
                <span
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-caption font-bold"
                  :class="
                    getVideoProgress(v.path)?.done
                      ? 'bg-charcoal-ink text-pure-white'
                      : getVideoProgress(v.path)?.ratio
                        ? 'bg-sunbeam-yellow/40 text-charcoal-ink'
                        : 'bg-page-cream text-stone'
                  "
                >
                  <AppIcon v-if="getVideoProgress(v.path)?.done" name="check" :size="14" />
                  <span v-else>{{ String(lessonNumber(v)).padStart(2, '0') }}</span>
                </span>
                <span class="min-w-0 flex-1">
                  <span
                    class="line-clamp-2 text-body-sm font-bold leading-snug text-charcoal-ink [overflow-wrap:anywhere] group-hover:text-deep-indigo"
                    :title="v.title"
                  >
                    {{ lessonTitle(v) }}
                  </span>
                  <span class="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-stone">
                    <span
                      v-if="v.path === progressVideo?.path"
                      class="rounded-full bg-deep-indigo/10 px-2 py-0.5 text-[11px] font-bold text-deep-indigo"
                    >
                      当前课节
                    </span>
                    <span
                      v-if="getVideoProgress(v.path)?.done"
                      class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink"
                    >
                      已完成
                    </span>
                    <span
                      v-else-if="getVideoProgress(v.path)?.ratio"
                      class="shrink-0 whitespace-nowrap font-medium text-charcoal-ink"
                    >
                      已看 {{ Math.round((getVideoProgress(v.path)?.ratio ?? 0) * 100) }}%
                    </span>
                  </span>
                </span>
                <span
                  class="mt-1 shrink-0 text-stone transition-transform duration-150 group-hover:translate-x-1 group-hover:text-charcoal-ink"
                >
                  <AppIcon name="chevron-right" :size="16" />
                </span>
              </button>
            </template>
          </CourseCatalogBranch>

          <div v-if="!filteredVideos.length" class="py-12 text-center text-body-sm text-stone">未找到匹配的课节</div>
        </div>
      </section>
    </div>
    <VDialog v-model="planOpen" max-width="640" aria-labelledby="overview-plan-title">
      <div class="paper-dialog overview-dialog">
        <header class="overview-dialog-header">
          <h2 id="overview-plan-title" class="text-heading-sm">学习计划</h2>
          <UiButton icon variant="text" title="关闭学习计划" @click="planOpen = false"
            ><AppIcon name="close" :size="19"
          /></UiButton>
        </header>
        <div class="scroll-soft space-y-6 overflow-y-auto p-6">
          <div v-if="timeSummary" class="space-y-3 text-body-sm leading-relaxed">
            <p v-if="timeSummary.plan" class="font-bold">{{ timeSummary.plan }}</p>
            <p class="text-stone">{{ timeSummary.video }}</p>
          </div>
          <PlanAdjustment />
          <div class="flex flex-wrap gap-2">
            <UiButton
              size="sm"
              @click="
                () => {
                  planOpen = false
                  tasksOpen = true
                }
              "
              >今日任务</UiButton
            >
            <UiButton
              v-if="activeModule"
              size="sm"
              @click="
                () => {
                  planOpen = false
                  stageOpen = true
                }
              "
              >阶段详情</UiButton
            >
            <UiButton
              size="sm"
              @click="
                () => {
                  planOpen = false
                  historyOpen = true
                }
              "
              >学习日历</UiButton
            >
          </div>
          <UiButton
            @click="
              () => {
                planOpen = false
                emit('guide', 'plan')
              }
            "
            ><AppIcon name="sparkles" :size="17" />{{ guide.state.plan ? '查看学习路线' : '定制学习路线' }}</UiButton
          >
        </div>
      </div>
    </VDialog>
    <VDialog v-model="stageOpen" max-width="880" aria-labelledby="overview-stage-title">
      <div class="paper-dialog overview-dialog">
        <header class="overview-dialog-header">
          <h2 id="overview-stage-title" class="text-heading-sm">阶段详情与验收</h2>
          <UiButton icon variant="text" title="关闭阶段详情" @click="stageOpen = false"
            ><AppIcon name="close" :size="19"
          /></UiButton>
        </header>
        <div v-if="activeModule" class="scroll-soft space-y-6 overflow-y-auto p-6">
          <VSelect
            label="当前阶段"
            :model-value="guide.state.records.activeModuleId"
            :items="[
              {
                value: '',
                title: guide.scheduledModule.value
                  ? `按计划日期：${guide.scheduledModule.value.title}`
                  : `按学习进度：${(guide.progressModule.value ?? activeModule).title}`,
              },
              ...stageOptions.map((m) => ({ value: m.id, title: m.title })),
            ]"
            @update:model-value="guide.setActiveModule($event ?? '')"
          />
          <p v-if="stageLag" class="text-caption text-deep-indigo">计划阶段与视频进度不同，可切换阶段或安排复盘。</p>
          <StageProgressBars v-if="activeProgress" inline :progress="activeProgress" />
          <StagePanel :module="activeModule" />
        </div>
      </div>
    </VDialog>
    <VDialog v-model="historyOpen" max-width="580" aria-labelledby="overview-history-title">
      <div class="paper-dialog overview-dialog">
        <header class="overview-dialog-header">
          <h2 id="overview-history-title" class="text-heading-sm">学习打卡</h2>
          <UiButton icon variant="text" title="关闭学习日历" @click="historyOpen = false"
            ><AppIcon name="close" :size="19"
          /></UiButton>
        </header>
        <div class="scroll-soft overflow-y-auto p-6">
          <CheckInCalendar
            compact
            @plan="
              () => {
                historyOpen = false
                emit('guide', 'plan')
              }
            "
          />
        </div>
      </div>
    </VDialog>
    <VDialog v-model="tasksOpen" max-width="880" aria-label="今日任务明细">
      <div class="paper-dialog overview-dialog">
        <header class="flex shrink-0 items-center justify-between border-b border-linen px-5 py-3">
          <h2 class="text-subheading">今日任务</h2>
          <div class="flex gap-2">
            <UiButton
              size="sm"
              variant="text"
              @click="
                () => {
                  tasksOpen = false
                  emit('guide', 'today')
                }
              "
              >调整安排</UiButton
            ><UiButton size="sm" icon title="关闭今日任务" @click="tasksOpen = false"
              ><AppIcon name="close" :size="18"
            /></UiButton>
          </div>
        </header>
        <div class="scroll-soft min-h-0 overflow-y-auto p-5">
          <ul
            v-if="allocation.length"
            class="mb-6 grid grid-cols-2 gap-4 rounded-2xl bg-page-cream p-4 sm:grid-cols-4"
            aria-label="今日时间分配"
          >
            <li v-for="item in allocation" :key="item.key">
              <p class="text-caption text-stone">{{ item.label }}</p>
              <p class="mt-2 text-body-sm font-bold">{{ item.done }} / {{ item.target }} 分钟</p>
            </li>
          </ul>
          <h3 class="text-body font-bold">
            视频学习
            <span class="ml-2 text-caption font-normal text-stone"
              >{{ videoItems.filter((i) => i.done).length }} / {{ videoItems.length }}</span
            >
          </h3>
          <ul v-if="videoItems.length" class="mt-2 space-y-2">
            <li
              v-for="item in videoItems"
              :key="item.id"
              class="flex items-start gap-3 rounded-xl border border-linen bg-pure-white p-3"
            >
              <VCheckbox
                :model-value="item.done"
                class="shrink-0"
                :aria-label="`完成：${itemTitle(item)}`"
                @update:model-value="guide.completeTodayItem(item.id, !!$event)"
              />
              <div class="min-w-0 flex-1">
                <button
                  type="button"
                  class="block max-w-full text-left text-body-sm font-bold text-charcoal-ink [overflow-wrap:anywhere] hover:text-deep-indigo"
                  :class="item.done ? 'text-stone line-through' : ''"
                  @click="startItem(item)"
                >
                  {{ itemTitle(item) }}
                </button>
                <p class="mt-1 text-caption text-stone">
                  {{ item.kind === 'review' ? '补学基础' : '学习片段' }} · {{ formatStudyDuration(item.seconds)
                  }}{{ item.estimated ? '（估算）' : '' }}
                </p>
              </div>
            </li>
          </ul>
          <p v-else class="mt-2 rounded-xl border border-linen bg-pure-white p-3 text-caption text-stone">
            {{
              !guide.state.plan
                ? '尚未生成学习路线。'
                : guide.lightDay.value || guide.todayBudget.value?.video === 0
                  ? '今日未安排视频学习。'
                  : '暂无待学课节。'
            }}
          </p>

          <h3 class="mt-5 text-body font-bold">
            实践任务
            <span class="ml-2 text-caption font-normal text-stone"
              >{{ workDone }} / {{ guide.todayWork.value.length }}</span
            >
          </h3>
          <TodayWorkList v-if="guide.todayWork.value.length" class="mt-3" />
          <p v-else class="mt-2 text-body-sm text-stone">今日暂无实践任务。</p>
        </div>
      </div>
    </VDialog>
  </div>
</template>

<style scoped>
.overview-course-actions :deep(.ui-button) {
  min-width: 96px;
  box-shadow: none;
}
.overview-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 28px 24px 48px;
  background: var(--color-page-cream);
}
.overview-shell {
  max-width: 1240px;
  margin-inline: auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 24px;
  width: 100%;
}
.overview-catalog {
  grid-row: 2;
}
.course-lesson-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: 16px;
}
.overview-current-lesson {
  border-color: var(--color-deep-indigo) !important;
  background: color-mix(in srgb, var(--color-deep-indigo) 5%, var(--color-pure-white)) !important;
}
.course-panels :deep(.v-expansion-panel-title) {
  padding: 18px 20px;
}
.stage-details :deep(.v-expansion-panel-title) {
  min-height: 40px;
  padding-block: 8px;
}
.overview-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 48px);
}
.overview-dialog-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-linen);
}
@media (max-width: 639px) {
  .overview-page {
    padding: 20px 14px 36px;
  }
  .overview-shell {
    gap: 20px;
  }
}
</style>

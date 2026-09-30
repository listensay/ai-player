<script setup lang="ts">
import { computed, reactive, ref, watch, nextTick } from 'vue'
import { useCourseStore } from '~/composables/useCourseStore'
import { useGuide } from '~/composables/useLearningGuide'
import { useProgress } from '~/composables/useProgress'
import type { VirtualListHandle } from '~/types/virtualList'
import VirtualList from '~/components/VirtualList.vue'
import { courseTreeRows, type CourseEntryRow } from '~/utils/courseTreeRows'
import AppIcon from '~/components/AppIcon.vue'
import CourseTreeNode from '~/components/CourseTreeNode.vue'
import ContinueStudyButton from '~/components/ContinueStudyButton.vue'
import type { Course, FolderEntry, TreeFilter, VideoEntry } from '~/types/course'
import type { TodayItem } from '~/types/guide'

const props = defineProps<{
  course: Course
  currentPath: string | null
}>()

const emit = defineEmits<{
  select: [video: VideoEntry]
  guide: []
  start: [path: string]
  startToday: [item: TodayItem]
}>()

const store = useCourseStore()
const progress = useProgress()
const guide = useGuide()
const routeView = guide.routeView
const showAllRoute = ref(false)
watch(
  () => [props.course.id, guide.todayDate.value],
  () => {
    showAllRoute.value = false
  },
)
const todayReady = computed(
  () => guide.guideReady.value && guide.recordsReady.value && guide.state.today?.date === guide.todayDate.value,
)
const todayItems = computed(() =>
  todayReady.value ? guide.state.today!.items.filter((item) => item.kind === 'lesson' || item.kind === 'review') : [],
)
const todayRoute = computed(() => {
  const paths = new Set(todayItems.value.map((item) => item.path))
  // Keep the route order and each video once, even when today has multiple segments.
  return guide.routeVideos.value.filter((video) => paths.has(video.path))
})
const routeInScope = computed(() => (showAllRoute.value ? guide.routeVideos.value : todayRoute.value))
const visibleRoute = computed(() => routeInScope.value.filter(matchesVideo))
const nextTodayItem = computed(() =>
  todayRoute.value
    .map((video) => todayItems.value.find((item) => item.path === video.path && !item.done))
    .find((item) => !!item),
)
const canStart = computed(() => (showAllRoute.value ? !!guide.firstLesson.value : !!nextTodayItem.value))
const startLabel = computed(() =>
  showAllRoute.value
    ? !guide.firstLesson.value
      ? '暂无待学课节'
      : guide.schedule.value.completed
        ? '继续学习'
        : '开始学习'
    : !todayReady.value
      ? '今日安排加载中'
      : nextTodayItem.value
        ? '开始学习'
        : todayRoute.value.length
          ? '今日视频已完成'
          : '今日暂无视频安排',
)
const routeEmptyLabel = computed(() =>
  !showAllRoute.value && !todayReady.value
    ? guide.state.storageError
      ? '今日安排读取失败'
      : '今日安排加载中…'
    : !showAllRoute.value && !todayRoute.value.length
      ? '今日暂无视频安排'
      : '未找到匹配的课节',
)
const moduleTitles = computed(() => new Map(guide.state.plan?.modules.map((m) => [m.id, m.title]) ?? []))
function routeModule(path: string) {
  return guide.lessonMap.value.get(path)?.moduleId
}

/** 路线按阶段折叠：默认展开当前阶段与正在播放课节所在阶段，搜索或筛选时全部展开。 */
const openModules = reactive(new Set<string>())
watch(
  () => [guide.activeModule.value?.id, props.currentPath ? routeModule(props.currentPath) : undefined],
  (ids) => {
    for (const id of ids) if (id) openModules.add(id)
  },
  { immediate: true },
)
const routeGroups = computed(() => {
  const result: Array<{ key: string; moduleId: string; videos: VideoEntry[] }> = []
  for (const v of visibleRoute.value) {
    const id = routeModule(v.path) ?? ''
    const last = result.at(-1)
    if (last?.moduleId === id) last.videos.push(v)
    else result.push({ key: `${id}:${result.length}`, moduleId: id, videos: [v] })
  }
  return result
})
const routeOpen = (id: string) => isFiltering.value || openModules.has(id)
const allRouteOpen = computed(() => routeGroups.value.every((g) => openModules.has(g.moduleId)))
function setModuleOpen(id: string, value: unknown) {
  if (value === 'content') openModules.add(id)
  else openModules.delete(id)
}
function toggleRouteAll() {
  if (allRouteOpen.value) openModules.clear()
  else for (const g of routeGroups.value) openModules.add(g.moduleId)
}

function startRoute() {
  if (!showAllRoute.value) {
    if (nextTodayItem.value) emit('startToday', nextTodayItem.value)
    return
  }
  const lesson = guide.firstLesson.value
  if (!lesson) return
  guide.state.view = 'route'
  emit('start', lesson.path)
}

function selectRouteVideo(video: VideoEntry) {
  const items = todayItems.value.filter((item) => item.path === video.path)
  const item = items.find((item) => !item.done) ?? items[0]
  if (!showAllRoute.value && item) emit('startToday', item)
  else emit('select', video)
}

const listEl = ref<HTMLElement>()
const virtualList = ref<VirtualListHandle>()
const expanded = reactive(new Set<string>())

const filters: Array<{ value: TreeFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'unfinished', label: '未完成' },
  { value: 'done', label: '已完成' },
]

function matchesVideo(v: VideoEntry): boolean {
  const q = store.state.query.trim().toLowerCase()
  if (q && !v.title.toLowerCase().includes(q) && !v.path.toLowerCase().includes(q)) return false
  if (store.state.filter === 'all') return true
  const p = progress.get(props.course.id, v.path)
  if (store.state.filter === 'done') return !!p?.done
  if (store.state.filter === 'unfinished') return !p?.done
  return true
}

/** 按搜索词与筛选条件裁剪后的树；没有匹配课时的章节会被隐藏 */
function filterFolder(folder: FolderEntry): FolderEntry | null {
  const children: FolderEntry['children'] = []
  let videoCount = 0
  for (const c of folder.children) {
    if (c.kind === 'folder') {
      const f = filterFolder(c)
      if (f) {
        children.push(f)
        videoCount += f.videoCount
      }
    } else if (matchesVideo(c)) {
      children.push(c)
      videoCount += 1
    }
  }
  if (videoCount === 0) return null
  return { ...folder, children, videoCount }
}

const isFiltering = computed(() => store.state.query.trim() !== '' || store.state.filter !== 'all')

const visibleRoot = computed(() => {
  // 依赖进度变化，筛选“已完成”时能实时刷新
  void progress.state.map
  return filterFolder(props.course.root)
})

type ModuleRow = { kind: 'module'; key: string; moduleId: string; count: number }
const virtualized = computed(() =>
  routeView.value ? routeInScope.value.length > 100 : props.course.root.videoCount > 100,
)
const rows = computed<Array<CourseEntryRow | ModuleRow>>(() => {
  if (!routeView.value) return visibleRoot.value ? courseTreeRows(visibleRoot.value, expanded) : []
  const entry = (node: VideoEntry): CourseEntryRow => ({ kind: 'entry', key: node.path, node, depth: 0 })
  if (!showAllRoute.value) return visibleRoute.value.map(entry)
  return routeGroups.value.flatMap((group) => [
    { kind: 'module' as const, key: `module:${group.key}`, moduleId: group.moduleId, count: group.videos.length },
    ...(routeOpen(group.moduleId) ? group.videos.map(entry) : []),
  ])
})
watch(
  () => [routeView.value, showAllRoute.value, store.state.query, store.state.filter],
  () => {
    nextTick(() => {
      if (virtualized.value) void virtualList.value?.scrollToIndex(0)
      else if (listEl.value) listEl.value.scrollTop = 0
    })
  },
)

function collectFolderPaths(folder: FolderEntry, out: string[] = []) {
  for (const c of folder.children) {
    if (c.kind === 'folder') {
      out.push(c.path)
      collectFolderPaths(c, out)
    }
  }
  return out
}

function toggle(path: string) {
  if (expanded.has(path)) expanded.delete(path)
  else expanded.add(path)
}

function expandAll() {
  for (const p of collectFolderPaths(props.course.root)) expanded.add(p)
}

function collapseAll() {
  expanded.clear()
}

/** 展开当前课时所在的所有上级章节，并滚动到可见 */
function revealCurrent() {
  const path = props.currentPath
  if (!path) return
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'))
  nextTick(() => {
    if (virtualized.value) {
      const index = rows.value.findIndex((row) => row.kind === 'entry' && row.node.path === path)
      void virtualList.value?.scrollToIndex(index, 'nearest')
      return
    }
    const list = listEl.value
    const el = list?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
    if (!el || !list || !list.clientHeight) return
    const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top
    if (top < 0) list.scrollTop += top
    else if (top + el.offsetHeight > list.clientHeight) list.scrollTop += top + el.offsetHeight - list.clientHeight
  })
}

// 搜索时把所有章节展开，方便看到命中项
watch(
  () => store.state.query,
  (q) => {
    if (q.trim()) expandAll()
  },
)

watch(() => props.currentPath, revealCurrent, { immediate: true })

const allExpanded = computed(() => {
  const all = collectFolderPaths(props.course.root)
  return all.length > 0 && all.every((p) => expanded.has(p))
})

const hasFolders = computed(() => props.course.root.children.some((c) => c.kind === 'folder'))
</script>

<template>
  <section class="pane flex min-h-0 flex-col" aria-label="课程目录">
    <header class="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
      <h2 class="min-w-0 flex-1 text-subheading font-bold">{{ routeView ? '学习路线' : '目录' }}</h2>
      <button
        v-if="hasFolders && !routeView"
        type="button"
        class="rounded-full px-2.5 py-1 text-caption font-medium text-stone transition-colors hover:bg-cream-deep hover:text-charcoal-ink"
        @click="allExpanded ? collapseAll() : expandAll()"
      >
        {{ allExpanded ? '全部收起' : '全部展开' }}
      </button>
      <button
        v-else-if="routeView && showAllRoute && routeGroups.length > 1 && !isFiltering"
        type="button"
        class="rounded-full px-2.5 py-1 text-caption font-medium text-stone transition-colors hover:bg-cream-deep hover:text-charcoal-ink"
        @click="toggleRouteAll"
      >
        {{ allRouteOpen ? '全部收起' : '全部展开' }}
      </button>
      <slot name="header-actions" />
    </header>

    <div class="px-4 pb-3">
      <div class="mb-3 flex rounded-full bg-page-cream p-1" aria-label="目录视图">
        <button
          type="button"
          :aria-pressed="!routeView"
          class="flex-1 rounded-full py-1.5 text-caption font-bold"
          :class="!routeView ? 'bg-pure-white' : 'text-stone'"
          @click="guide.state.view = 'all'"
        >
          完整目录
        </button>
        <button
          type="button"
          :aria-pressed="routeView"
          class="flex-1 rounded-full py-1.5 text-caption font-bold"
          :class="routeView ? 'bg-charcoal-ink text-pure-white' : 'text-stone'"
          @click="guide.state.plan ? (guide.state.view = 'route') : emit('guide')"
        >
          定制路线
        </button>
      </div>
      <div v-if="routeView" class="mb-3 rounded-xl border border-linen p-3">
        <div class="flex items-center justify-between gap-2">
          <p class="text-caption text-stone">
            已选 {{ guide.route.value.length }} 节 ·
            {{
              guide.program.value && (guide.planDay.value ?? 0) >= 1
                ? `计划第 ${guide.planDay.value} / ${guide.program.value.days} 天`
                : `视频排期约 ${guide.schedule.value.days} 天`
            }}
          </p>
          <button type="button" class="text-caption font-bold hover:text-deep-indigo" @click="emit('guide')">
            调整
          </button>
        </div>
        <label class="mt-2 flex items-center gap-2 text-caption text-graphite"
          ><VCheckbox
            v-model="guide.state.includeOptional"
            :disabled="!!guide.state.busy"
            class="shrink-0"
          />包含选修课</label
        >
        <button
          type="button"
          :disabled="!canStart"
          class="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-sunbeam-yellow/30 py-2 text-body-sm font-bold disabled:opacity-50"
          @click="startRoute"
        >
          <AppIcon name="play" :size="15" />{{ startLabel }}
        </button>
        <ContinueStudyButton v-if="!showAllRoute" class="mt-3" @segment="emit('startToday', $event)" />
        <button
          v-if="guide.risks.value.length"
          type="button"
          class="mt-2 text-left text-caption text-error hover:text-deep-indigo"
          @click="emit('guide')"
        >
          {{ guide.risks.value.length }} 节前置课未加入路线，查看建议
        </button>
      </div>
      <div>
        <VTextField
          :model-value="store.state.query"
          type="search"
          label="搜索课节"
          clearable
          @update:model-value="store.state.query = $event ?? ''"
        >
          <template #prepend-inner><AppIcon name="search" :size="18" /></template>
        </VTextField>
      </div>

      <div class="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="按观看状态筛选">
        <button
          v-for="f in filters"
          :key="f.value"
          type="button"
          role="radio"
          :aria-checked="store.state.filter === f.value"
          class="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-caption font-medium transition-colors duration-100 ease-soft"
          :class="
            store.state.filter === f.value
              ? 'bg-charcoal-ink text-pure-white'
              : 'border border-linen bg-pure-white text-charcoal-ink hover:bg-cream-deep'
          "
          @click="store.state.filter = f.value"
        >
          <span
            v-if="store.state.filter === f.value"
            class="h-1.5 w-1.5 rounded-full bg-pure-white"
            aria-hidden="true"
          />
          {{ f.label }}
        </button>
      </div>
      <div v-if="routeView" class="mt-3 flex items-center justify-between gap-2">
        <span class="text-caption font-medium text-stone"
          >{{ showAllRoute ? '全部视频' : '今日视频' }} · {{ routeInScope.length }} 节</span
        >
        <button
          type="button"
          :aria-pressed="showAllRoute"
          class="rounded-full border border-linen px-2.5 py-1 text-caption font-bold transition-colors hover:bg-cream-deep"
          @click="showAllRoute = !showAllRoute"
        >
          {{ showAllRoute ? '只看今天' : '显示全部' }}
        </button>
      </div>
    </div>

    <div
      ref="listEl"
      class="scroll-soft min-h-0 flex-1 px-2 pb-3"
      :class="virtualized ? 'overflow-hidden' : 'overflow-y-auto'"
    >
      <VirtualList
        v-if="virtualized && rows.length"
        ref="virtualList"
        class="h-full"
        :items="rows"
        :item-key="(row) => row.key"
        :item-height="36"
        :aria-label="routeView ? (showAllRoute ? 'AI 推荐课节' : '今日视频') : '完整目录'"
      >
        <template #default="{ item }">
          <CourseTreeNode
            v-if="item.kind === 'entry'"
            :node="item.node"
            :depth="item.depth"
            :course-id="course.id"
            :current-path="currentPath"
            :expanded="expanded"
            flat
            :route-position="routeView ? guide.routePositions.value.get(item.node.path) : undefined"
            @select="routeView ? selectRouteVideo($event) : emit('select', $event)"
            @toggle="toggle"
          />
          <VExpansionPanels
            v-else
            class="sidebar-panels pt-2"
            :model-value="routeOpen(item.moduleId) ? 'content' : undefined"
            :readonly="isFiltering"
            @update:model-value="setModuleOpen(item.moduleId, $event)"
          >
            <VExpansionPanel value="content"
              ><VExpansionPanelTitle
                ><span class="min-w-0 flex-1 [overflow-wrap:anywhere]">{{ moduleTitles.get(item.moduleId) }}</span
                ><span class="tabular shrink-0 font-medium text-stone">{{ item.count }}</span></VExpansionPanelTitle
              ></VExpansionPanel
            >
          </VExpansionPanels>
        </template>
      </VirtualList>
      <ul v-else-if="routeView && !showAllRoute && visibleRoute.length" aria-label="今日视频">
        <CourseTreeNode
          v-for="entry in visibleRoute"
          :key="entry.path"
          :node="entry"
          :depth="0"
          :course-id="course.id"
          :current-path="currentPath"
          :expanded="expanded"
          :route-position="guide.routePositions.value.get(entry.path)"
          @select="selectRouteVideo"
        />
      </ul>
      <ul v-else-if="routeView && visibleRoute.length" aria-label="AI 推荐课节">
        <li v-for="group in routeGroups" :key="group.key" class="pt-2">
          <VExpansionPanels
            class="sidebar-panels"
            :model-value="routeOpen(group.moduleId) ? 'content' : undefined"
            :readonly="isFiltering"
            @update:model-value="setModuleOpen(group.moduleId, $event)"
          >
            <VExpansionPanel value="content">
              <VExpansionPanelTitle>
                <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">{{ moduleTitles.get(group.moduleId) }}</span>
                <span class="tabular shrink-0 font-medium text-stone">{{ group.videos.length }}</span>
              </VExpansionPanelTitle>
              <VExpansionPanelText>
                <ul>
                  <CourseTreeNode
                    v-for="entry in group.videos"
                    :key="entry.path"
                    :node="entry"
                    :depth="0"
                    :course-id="course.id"
                    :current-path="currentPath"
                    :expanded="expanded"
                    :route-position="guide.routePositions.value.get(entry.path)"
                    @select="emit('select', $event)"
                  />
                </ul>
              </VExpansionPanelText>
            </VExpansionPanel>
          </VExpansionPanels>
        </li>
      </ul>
      <p v-else-if="routeView" class="px-2 py-8 text-center text-body-sm text-stone">{{ routeEmptyLabel }}</p>
      <ul v-else-if="visibleRoot" role="tree">
        <CourseTreeNode
          v-for="child in visibleRoot.children"
          :key="child.path"
          :node="child"
          :depth="0"
          :course-id="course.id"
          :current-path="currentPath"
          :expanded="expanded"
          @select="emit('select', $event)"
          @toggle="toggle"
        />
      </ul>
      <p v-else class="px-2 py-8 text-center text-body-sm text-stone">
        {{ isFiltering ? '未找到匹配的课节' : '当前文件夹中未找到视频' }}
      </p>
    </div>
    <button
      v-if="!guide.state.plan"
      type="button"
      class="m-3 mt-0 flex items-center gap-3 rounded-xl bg-page-cream p-3 text-left"
      @click="emit('guide')"
    >
      <AppIcon name="sparkles" :size="22" class="text-deep-indigo" /><span
        ><span class="block text-body-sm font-bold">定制学习路线</span
        ><span class="mt-1 block text-caption text-stone">设置学习基础与目标 →</span></span
      >
    </button>
  </section>
</template>

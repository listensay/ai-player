<script setup lang="ts">
import type { Course, FolderEntry, TreeFilter, VideoEntry } from '~/types/course'

const props = defineProps<{
  course: Course
  currentPath: string | null
}>()

const emit = defineEmits<{
  select: [video: VideoEntry]
}>()

const store = useCourseStore()
const progress = useProgress()

const listEl = ref<HTMLElement>()
const expanded = reactive(new Set<string>())

const filters: Array<{ value: TreeFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'unfinished', label: '未看完' },
  { value: 'done', label: '已看完' },
]

function matchesVideo(v: VideoEntry): boolean {
  const q = store.state.query.trim().toLowerCase()
  if (q && !v.title.toLowerCase().includes(q) && !v.path.toLowerCase().includes(q)) return false
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
  // 依赖进度变化，筛选“已看完”时能实时刷新
  void progress.state.map
  return filterFolder(props.course.root)
})

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
    const el = listEl.value?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
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
      <h2 class="text-subheading font-bold">目录</h2>
      <button
        v-if="hasFolders"
        type="button"
        class="rounded-full px-2.5 py-1 text-caption font-medium text-stone transition-colors hover:bg-cream-deep hover:text-charcoal-ink"
        @click="allExpanded ? collapseAll() : expandAll()"
      >
        {{ allExpanded ? '全部收起' : '全部展开' }}
      </button>
    </header>

    <div class="px-4 pb-3">
      <label class="relative block">
        <span class="sr-only">搜索课时</span>
        <AppIcon
          name="search"
          :size="16"
          class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone"
        />
        <input
          v-model="store.state.query"
          type="search"
          placeholder="搜索课时"
          class="h-9 w-full rounded-lg border border-ash bg-pure-white pr-3 pl-9 text-body-sm text-charcoal-ink placeholder:text-stone focus:border-charcoal-ink focus:outline-none"
        />
      </label>

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
    </div>

    <div ref="listEl" class="scroll-soft min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <ul v-if="visibleRoot" role="tree">
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
        {{ isFiltering ? '没有符合条件的课时' : '这个文件夹里没有视频' }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { FolderEntry, VideoEntry } from '~/types/course'

const props = defineProps<{
  node: FolderEntry | VideoEntry
  depth: number
  courseId: string
  currentPath: string | null
  expanded: Set<string>
}>()

const emit = defineEmits<{
  select: [video: VideoEntry]
  toggle: [path: string]
}>()

const progress = useProgress()

const isFolder = computed(() => props.node.kind === 'folder')
const isOpen = computed(() => props.node.kind === 'folder' && props.expanded.has(props.node.path))
const isCurrent = computed(() => props.node.kind === 'video' && props.node.path === props.currentPath)

const videoProgress = computed(() =>
  props.node.kind === 'video' ? progress.get(props.courseId, props.node.path) : undefined,
)

/** 章节内已看完 / 总数 */
const folderStats = computed(() => {
  if (props.node.kind !== 'folder') return null
  let done = 0
  const walk = (f: FolderEntry) => {
    for (const c of f.children) {
      if (c.kind === 'folder') walk(c)
      else if (progress.get(props.courseId, c.path)?.done) done++
    }
  }
  walk(props.node)
  return { done, total: props.node.videoCount }
})

/** 进度圆点：conic-gradient 从 linen 填到 charcoal；当前集为黄色 */
const dotStyle = computed(() => {
  const p = videoProgress.value
  const ratio = p?.done ? 1 : (p?.ratio ?? 0)
  const deg = Math.round(ratio * 360)
  return {
    background: `conic-gradient(var(--color-charcoal-ink) ${deg}deg, var(--color-linen) ${deg}deg)`,
  }
})

/** 视频文件名里常见的序号前缀，单独弱化显示："01-环境搭建" -> ["01", "环境搭建"] */
const titleParts = computed(() => {
  if (props.node.kind !== 'video') return null
  const m = /^(\d{1,4})[\s._\-—–、:：]+(.+)$/.exec(props.node.title)
  return m ? { index: m[1]!, text: m[2]! } : { index: '', text: props.node.title }
})

const indent = computed(() => `${8 + props.depth * 14}px`)

function onClick() {
  if (props.node.kind === 'folder') emit('toggle', props.node.path)
  else emit('select', props.node)
}
</script>

<template>
  <li>
    <button
      type="button"
      class="group flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 text-left transition-colors duration-100 ease-soft hover:bg-cream-deep"
      :class="[
        isCurrent ? 'bg-page-cream text-charcoal-ink' : 'text-charcoal-ink',
        isFolder ? 'mt-1' : '',
      ]"
      :style="{ paddingLeft: indent }"
      :aria-expanded="isFolder ? isOpen : undefined"
      :aria-current="isCurrent ? 'true' : undefined"
      :data-path="node.path"
      @click="onClick"
    >
      <!-- 章节：填充式 chevron，展开时旋转 -->
      <template v-if="isFolder">
        <AppIcon
          name="chevron-right"
          :size="16"
          class="text-stone transition-transform duration-150 ease-soft"
          :class="isOpen ? 'rotate-90' : ''"
        />
        <span class="min-w-0 flex-1 truncate text-body-sm font-bold">{{ node.name }}</span>
        <span v-if="folderStats" class="tabular shrink-0 text-caption text-stone">
          {{ folderStats.done }}/{{ folderStats.total }}
        </span>
      </template>

      <!-- 课时：进度圆点 + 标题 -->
      <template v-else>
        <span class="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <span
            v-if="isCurrent"
            class="h-3 w-3 rounded-full bg-sunbeam-yellow ring-2 ring-charcoal-ink"
            aria-hidden="true"
          />
          <span
            v-else-if="videoProgress?.done"
            class="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-charcoal-ink text-pure-white"
            aria-hidden="true"
          >
            <AppIcon name="check" :size="10" />
          </span>
          <span v-else class="h-3 w-3 rounded-full" :style="dotStyle" aria-hidden="true" />
        </span>
        <span class="min-w-0 flex-1 truncate text-body-sm" :class="isCurrent ? 'font-bold' : 'font-medium'">
          <span v-if="titleParts?.index" class="tabular mr-1.5 text-stone">{{ titleParts.index }}</span>{{ titleParts?.text }}
        </span>
        <span
          v-if="videoProgress && !videoProgress.done && videoProgress.ratio > 0"
          class="tabular shrink-0 text-caption text-stone"
        >
          {{ Math.round(videoProgress.ratio * 100) }}%
        </span>
        <span class="sr-only">
          {{ isCurrent ? '正在播放' : videoProgress?.done ? '已看完' : '' }}
        </span>
      </template>
    </button>

    <ul v-if="isFolder && isOpen && node.kind === 'folder'" role="group">
      <CourseTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :course-id="courseId"
        :current-path="currentPath"
        :expanded="expanded"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
      />
    </ul>
  </li>
</template>

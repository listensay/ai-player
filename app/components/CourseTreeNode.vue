<script setup lang="ts">
import { computed } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import { useProgress } from '~/composables/useProgress'
import AppIcon from '~/components/AppIcon.vue'
import LessonBadge from '~/components/LessonBadge.vue'
import type { FolderEntry, VideoEntry } from '~/types/course'
import { conciseLessonTitle } from '~/utils/studyProgram'

const props = defineProps<{
  node: FolderEntry | VideoEntry
  depth: number
  courseId: string
  currentPath: string | null
  expanded: Set<string>
  /** 定制路线中的序号，与原文件名序号分开。 */
  routePosition?: number
}>()

const emit = defineEmits<{
  select: [video: VideoEntry]
  toggle: [path: string]
}>()

const progress = useProgress()
const guide = useGuide()
const lesson = computed(() => guide.lessonMap.value.get(props.node.path))

const isOpen = computed(() => props.node.kind === 'folder' && props.expanded.has(props.node.path))
const isCurrent = computed(() => props.node.kind === 'video' && props.node.path === props.currentPath)

const videoProgress = computed(() =>
  props.node.kind === 'video' ? progress.get(props.courseId, props.node.path) : undefined,
)

/** 章节内已完成 / 总数 */
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
  if (props.node.kind === 'video') emit('select', props.node)
}
</script>

<template>
  <li>
    <VExpansionPanels v-if="node.kind === 'folder'" class="sidebar-panels" :model-value="isOpen ? 'content' : undefined" @update:model-value="emit('toggle', node.path)">
      <VExpansionPanel value="content">
        <VExpansionPanelTitle :style="{ paddingLeft: indent }" :data-path="node.path" :title="node.name">
          <span class="min-w-0 flex-1 truncate text-body-sm font-bold">{{ node.name }}</span>
          <span v-if="folderStats" class="tabular shrink-0 text-caption text-stone">{{ folderStats.done }}/{{ folderStats.total }}</span>
        </VExpansionPanelTitle>
        <VExpansionPanelText>
          <ul role="group">
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
        </VExpansionPanelText>
      </VExpansionPanel>
    </VExpansionPanels>
    <button v-else
      type="button"
      class="group flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 text-left transition-colors duration-100 ease-soft hover:bg-cream-deep"
      :class="[
        isCurrent ? 'bg-page-cream text-charcoal-ink' : 'text-charcoal-ink',
      ]"
      :style="{ paddingLeft: indent }"
      :aria-current="isCurrent ? 'true' : undefined"
      :data-path="node.path"
      :data-route-position="routePosition"
      :title="node.title"
      @click="onClick"
    >
      <!-- 课时：进度圆点 + 标题 -->
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
      <span class="min-w-0 flex-1 text-body-sm" :class="[isCurrent ? 'font-bold' : 'font-medium', routePosition ? '[overflow-wrap:anywhere]' : 'truncate']">
        <span v-if="routePosition" class="tabular mr-1.5 font-bold text-deep-indigo">{{ String(routePosition).padStart(2, '0') }}</span>
        <span v-else-if="titleParts?.index" class="tabular mr-1.5 text-stone">{{ titleParts.index }}</span>{{ routePosition && node.kind === 'video' ? conciseLessonTitle(node.title) : titleParts?.text }}
      </span>
      <span
        v-if="videoProgress && !videoProgress.done && videoProgress.ratio > 0"
        class="tabular shrink-0 text-caption text-stone"
      >
        {{ Math.round(videoProgress.ratio * 100) }}%
      </span>
      <span class="sr-only">
        {{ isCurrent ? '正在播放' : videoProgress?.done ? '已完成' : '' }}
      </span>
      <LessonBadge v-if="lesson" :status="lesson.status" compact />
    </button>
  </li>
</template>

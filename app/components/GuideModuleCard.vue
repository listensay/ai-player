<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import type { GuideLesson, KnowledgeModule } from '~/types/guide'
import { conciseLessonTitle } from '~/utils/studyProgram'
import AppIcon from './AppIcon.vue'
import ConceptMastery from './ConceptMastery.vue'
import LessonBadge from './LessonBadge.vue'
import StagePanel from './StagePanel.vue'
import StageProgressBars from './StageProgressBars.vue'
import UiButton from './UiButton.vue'

const props = defineProps<{ module: KnowledgeModule; lessons: GuideLesson[]; index: number }>()
defineEmits<{ select: [path: string] }>()
const guide = useGuide()
const open = ref(false)
const page = ref(1)
const pageSize = 20
const pages = computed(() => Math.max(1, Math.ceil(props.lessons.length / pageSize)))
const currentPage = computed(() => Math.min(page.value, pages.value))
const visible = computed(() => props.lessons.slice((currentPage.value - 1) * pageSize, currentPage.value * pageSize))
const practiceOpen = ref(guide.activeModule.value?.id === props.module.id)
const dependencies = computed(() => [...new Set(props.lessons.flatMap(l => l.prerequisites.map(p => guide.lessonMap.value.get(p)?.moduleId)))]
  .filter(id => id && id !== props.module.id).map(id => guide.moduleMap.value.get(id!)?.title ?? id))
function title(path: string) { return conciseLessonTitle(guide.videoMap.value.get(path)?.title ?? path) }
</script>

<template>
  <article class="pane p-5">
    <div class="flex items-center gap-3"><span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sunbeam-yellow/25 font-bold">{{ String(index + 1).padStart(2, '0') }}</span><h4 class="text-body font-bold">{{ module.title }}</h4><span class="ml-auto shrink-0 text-caption text-stone">{{ lessons.length }} 节</span></div>
    <p class="mt-3 text-body-sm leading-relaxed text-graphite">{{ module.description }}</p>
    <p class="mt-3 rounded-lg bg-page-cream p-3 text-caption text-deep-indigo">{{ dependencies.length ? `先修板块：${dependencies.join('、')}` : '起点板块 · 无跨板块前置依赖' }}</p>
    <StageProgressBars v-if="module.practice && guide.stageProgressMap.value.get(module.id)" class="mt-4" inline :progress="guide.stageProgressMap.value.get(module.id)!" />
    <VExpansionPanels v-if="module.practice" :model-value="practiceOpen ? 'content' : undefined" @update:model-value="practiceOpen = $event === 'content'" class="my-3">
      <VExpansionPanel value="content">
        <VExpansionPanelTitle>阶段目标、任务与验收</VExpansionPanelTitle>
        <VExpansionPanelText>
          <StagePanel class="mt-3" :module="module" />
        </VExpansionPanelText>
      </VExpansionPanel>
    </VExpansionPanels>
    <VExpansionPanels :model-value="open ? 'content' : undefined" @update:model-value="open = $event === 'content'" class="my-3">
      <VExpansionPanel value="content">
        <VExpansionPanelTitle>知识点与课节依赖</VExpansionPanelTitle>
        <VExpansionPanelText>
          <ul class="mt-2 divide-y divide-linen">
            <li v-for="lesson in visible" :key="lesson.path" :data-map-lesson="lesson.path" class="py-3">
              <div class="flex items-start gap-2"><button class="min-w-0 flex-1 text-left text-body-sm hover:text-deep-indigo" @click="$emit('select', lesson.path)">{{ title(lesson.path) }}</button><LessonBadge :status="lesson.status" compact /></div>
              <ConceptMastery :lesson="lesson" />
              <p v-if="lesson.prerequisites.length" class="mt-1 text-caption text-deep-indigo">前置课程：{{ lesson.prerequisites.map(title).join('、') }}</p>
            </li>
          </ul>
          <nav v-if="pages > 1" aria-label="知识点分页" class="mt-3 flex items-center justify-between gap-2">
            <UiButton size="sm" icon title="上一页知识点" :disabled="currentPage === 1" @click="page = currentPage - 1"><AppIcon name="chevron-right" class="rotate-180" /></UiButton>
            <span class="text-caption text-stone">第 {{ currentPage }} / {{ pages }} 页 · 共 {{ lessons.length }} 节</span>
            <UiButton size="sm" icon title="下一页知识点" :disabled="currentPage === pages" @click="page = currentPage + 1"><AppIcon name="chevron-right" /></UiButton>
          </nav>
        </VExpansionPanelText>
      </VExpansionPanel>
    </VExpansionPanels>
  </article>
</template>

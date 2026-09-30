<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import { conciseLessonTitle } from '~/utils/studyProgram'
import UiButton from '~/components/UiButton.vue'

const props = withDefaults(defineProps<{ paths: string[]; label?: string }>(), { label: '关联课节' })
const emit = defineEmits<{ select: [path: string] }>()
const guide = useGuide()
const query = ref(''),
  page = ref(1)
const PAGE_SIZE = 5
const unique = computed(() => [...new Set(props.paths)])
function title(path: string) {
  return conciseLessonTitle(guide.videoMap.value.get(path)?.title ?? path.split('/').at(-1) ?? path)
}
function moduleTitle(path: string) {
  return guide.moduleMap.value.get(guide.lessonMap.value.get(path)?.moduleId ?? '')?.title ?? ''
}
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return unique.value.filter((path) => !q || `${title(path)} ${moduleTitle(path)} ${path}`.toLowerCase().includes(q))
})
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const currentPage = computed(() => Math.min(page.value, pages.value))
const visible = computed(() => filtered.value.slice((currentPage.value - 1) * PAGE_SIZE, currentPage.value * PAGE_SIZE))
watch([query, () => props.paths], () => {
  page.value = 1
})
</script>

<template>
  <section class="min-w-0" :aria-label="label">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h5 class="text-caption font-bold text-graphite">{{ label }}</h5>
      <span class="text-caption text-stone">{{ unique.length }} 节</span>
    </div>
    <VTextField
      v-if="unique.length > PAGE_SIZE"
      v-model="query"
      type="search"
      :label="`搜索${label}`"
      density="compact"
      hide-details
      class="mt-2"
    />
    <ul class="mt-2 divide-y divide-linen">
      <li v-for="path in visible" :key="path" class="flex items-start gap-2 py-2.5">
        <span class="mt-1 text-caption text-stone" aria-hidden="true">→</span>
        <div class="min-w-0 flex-1">
          <button
            type="button"
            class="block max-w-full break-words text-left text-body-sm font-medium hover:text-deep-indigo"
            :title="guide.videoMap.value.get(path)?.title ?? path"
            @click="emit('select', path)"
          >
            {{ title(path) }}
          </button>
          <p class="mt-0.5 text-caption text-stone">
            {{ moduleTitle(path) }}<span v-if="!guide.routePaths.value.includes(path)" class="ml-2">未加入路线</span>
          </p>
        </div>
      </li>
    </ul>
    <p v-if="!visible.length" class="py-3 text-caption text-stone">没有匹配的课节。</p>
    <nav v-if="pages > 1" class="mt-2 flex flex-wrap items-center justify-between gap-2" :aria-label="`${label}分页`">
      <UiButton
        size="sm"
        variant="text"
        :disabled="currentPage === 1"
        :aria-label="`上一页${label}`"
        @click="page = currentPage - 1"
        >上一页</UiButton
      >
      <span class="text-caption text-stone">{{ currentPage }} / {{ pages }} 页 · {{ filtered.length }} 节</span>
      <UiButton
        size="sm"
        variant="text"
        :disabled="currentPage === pages"
        :aria-label="`下一页${label}`"
        @click="page = currentPage + 1"
        >下一页</UiButton
      >
    </nav>
  </section>
</template>

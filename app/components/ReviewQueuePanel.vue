<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLearningManagement } from '~/composables/useLearningManagement'
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import { KNOWLEDGE_CATEGORY_LABELS } from '~/utils/practice'
import type { ReviewCard } from '~/types/learningManagement'
import PracticeText from './PracticeText.vue'
import UiButton from './UiButton.vue'
const learning = useLearningManagement(),
  workspace = useCourseWorkspace(),
  router = useRouter()
const courseId = ref(''),
  mastery = ref('weak'),
  category = ref(''),
  page = ref(1),
  busy = ref(false),
  error = ref('')
const names = computed(() => new Map(learning.courses.value.map((c) => [c.course.id, c.course.name])))
const courseOptions = computed(() => [
  { title: '全部课程', value: '' },
  ...learning.courses.value.map((c) => ({ title: c.course.name, value: c.course.id })),
])
const categories = [
  { title: '全部知识分类', value: '' },
  ...Object.entries(KNOWLEDGE_CATEGORY_LABELS).map(([value, title]) => ({ title, value })),
  { title: '重点笔记', value: 'note' },
  { title: '未分类', value: 'uncategorized' },
]
const weaknesses = computed(() =>
  learning.state.data.cards.filter(
    (c) =>
      (c.kind === 'practice' || c.weak || c.recall !== null) &&
      (!courseId.value || c.courseId === courseId.value) &&
      (!category.value || c.category === category.value) &&
      (mastery.value === 'all' ||
        (mastery.value === 'weak'
          ? c.weak
          : mastery.value === 'remembered'
            ? !c.weak && (c.recall === 'remembered' || c.kind === 'practice')
            : c.weak && (c.recall ?? 'forgotten') === mastery.value)),
  ),
)
const radar = computed(() => {
  const counts = new Map<string, number>()
  for (const c of weaknesses.value.filter((c) => c.weak))
    for (const concept of c.concepts) counts.set(concept, (counts.get(concept) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6)
})
watch([courseId, mastery, category], () => {
  page.value = 1
})
async function source(card: ReviewCard) {
  workspace.appDialogs.close()
  await router.push({
    path: `/courses/${encodeURIComponent(card.courseId)}/player`,
    query: { lesson: card.path, at: String(card.seconds) },
  })
}
async function drill(card: ReviewCard) {
  busy.value = true
  error.value = ''
  try {
    await workspace.openWeakPractice(card)
  } catch (e) {
    error.value = String(e)
    workspace.appDialogs.open('study', 'review')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="space-y-6" aria-label="抗遗忘复习">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 class="text-heading-sm">错题与薄弱项</h2>
        <p class="mt-2 text-body-sm text-stone">回看知识点，针对薄弱项补练，逐步掌握。</p>
      </div>
      <UiButton size="sm" :disabled="learning.loading.value" @click="learning.refresh">刷新</UiButton>
    </header>
    <p v-if="learning.state.notice" role="status" class="text-body-sm text-deep-indigo">{{ learning.state.notice }}</p>
    <p v-if="learning.sourceError.value || learning.state.error || error" role="alert" class="text-body-sm text-error">
      {{ learning.sourceError.value || learning.state.error || error }}
    </p>
    <VSelect v-model="courseId" label="课程" :items="courseOptions" />
    <div class="grid gap-3 sm:grid-cols-2">
      <VSelect
        v-model="mastery"
        label="掌握度"
        :items="[
          { title: '待加强', value: 'weak' },
          { title: '模糊', value: 'uncertain' },
          { title: '未掌握', value: 'forgotten' },
          { title: '已掌握', value: 'remembered' },
          { title: '全部', value: 'all' },
        ]"
      /><VSelect v-model="category" label="知识分类" :items="categories" />
    </div>
    <div v-if="radar.length" class="pane space-y-3 p-5">
      <h3 class="text-body font-bold">薄弱知识点</h3>
      <div v-for="[concept, count] in radar" :key="concept" class="space-y-1">
        <div class="flex justify-between gap-4 text-body-sm">
          <span>{{ concept }}</span
          ><span>{{ count }} 项</span>
        </div>
        <div class="h-2 rounded-full bg-page-cream">
          <div class="h-2 rounded-full bg-brand-orange" :style="{ width: `${(count / radar[0]![1]) * 100}%` }" />
        </div>
      </div>
    </div>
    <article v-for="card in weaknesses.slice((page - 1) * 10, page * 10)" :key="card.id" class="pane space-y-3 p-5">
      <p class="text-caption text-stone">{{ names.get(card.courseId) }} · {{ card.concepts.join('、') }}</p>
      <PracticeText :text="card.front" />
      <div class="flex flex-wrap gap-2">
        <UiButton size="sm" @click="source(card)">回看知识点</UiButton
        ><UiButton v-if="card.weak" size="sm" variant="dark" :disabled="busy" @click="drill(card)"
          >针对薄弱项补练 · 3 题</UiButton
        >
      </div>
    </article>
    <p v-if="!weaknesses.length" class="pane p-8 text-center text-body-sm text-stone">暂无符合条件的记录</p>
    <div v-if="weaknesses.length > 10" class="flex items-center justify-center gap-4">
      <UiButton :disabled="page <= 1" @click="page--">上一页</UiButton
      ><span>{{ page }} / {{ Math.ceil(weaknesses.length / 10) }}</span
      ><UiButton :disabled="page * 10 >= weaknesses.length" @click="page++">下一页</UiButton>
    </div>
  </section>
</template>

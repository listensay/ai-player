<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLearningManagement } from '~/composables/useLearningManagement'
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import { KNOWLEDGE_CATEGORY_LABELS } from '~/utils/practice'
import type { ReviewCard, Recall } from '~/types/learningManagement'
import PracticeText from './PracticeText.vue'
import UiButton from './UiButton.vue'
const learning = useLearningManagement(),
  workspace = useCourseWorkspace(),
  router = useRouter()
const tab = ref('review'),
  courseId = ref(''),
  mastery = ref('weak'),
  category = ref(''),
  revealed = ref(false),
  page = ref(1),
  busy = ref(false),
  error = ref('')
const current = computed(() => learning.due.value.find((c) => !courseId.value || c.courseId === courseId.value))
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
watch(
  () => current.value?.id,
  () => {
    revealed.value = false
  },
)
watch([courseId, mastery, category], () => {
  page.value = 1
})
async function rate(rating: Recall) {
  if (current.value && (await learning.rate(current.value.id, rating))) revealed.value = false
}
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
    <header class="pane rounded-3xl p-6">
      <p class="text-caption font-bold text-deep-indigo">每天几分钟，把知识记得更牢</p>
      <div class="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 class="text-heading-sm">
            今日待复习 <span class="tabular">{{ learning.due.value.length }}</span>
          </h2>
          <p class="mt-2 text-body-sm text-stone">
            {{
              learning.due.value.length
                ? `约 ${Math.max(1, Math.ceil(learning.due.value.length * 0.5))} 分钟`
                : '今天的复习已完成'
            }}
          </p>
        </div>
        <UiButton size="sm" :disabled="learning.loading.value" @click="learning.refresh">刷新</UiButton>
      </div>
    </header>
    <p v-if="learning.state.notice" role="status" class="text-body-sm text-deep-indigo">{{ learning.state.notice }}</p>
    <p v-if="learning.sourceError.value || learning.state.error || error" role="alert" class="text-body-sm text-error">
      {{ learning.sourceError.value || learning.state.error || error }}
    </p>
    <div class="flex gap-2">
      <UiButton :variant="tab === 'review' ? 'dark' : 'ghost'" @click="tab = 'review'">复习闪卡</UiButton
      ><UiButton :variant="tab === 'weakness' ? 'dark' : 'ghost'" @click="tab = 'weakness'">错题与薄弱项</UiButton>
    </div>
    <VSelect v-model="courseId" label="课程" :items="courseOptions" />
    <template v-if="tab === 'review'">
      <article v-if="current" class="pane space-y-5 p-6">
        <p class="text-caption text-stone">
          {{ names.get(current.courseId) }} ·
          {{ current.kind === 'note' ? '重点笔记' : current.kind === 'knowledge' ? '核心知识' : '课后练习' }}
        </p>
        <PracticeText :text="current.front" class="text-subheading" />
        <UiButton v-if="!revealed" variant="dark" @click="revealed = true">翻看答案</UiButton>
        <template v-else>
          <div class="rounded-2xl bg-page-cream p-5"><PracticeText :text="current.back" /></div>
          <UiButton size="sm" variant="text" @click="source(current)">回看原视频 / 笔记</UiButton>
          <div class="flex flex-wrap gap-3">
            <UiButton :disabled="!!learning.state.saving" @click="rate('forgotten')">忘记</UiButton
            ><UiButton :disabled="!!learning.state.saving" @click="rate('uncertain')">模糊</UiButton
            ><UiButton variant="dark" :disabled="!!learning.state.saving" @click="rate('remembered')">已牢记</UiButton>
          </div>
        </template>
      </article>
      <div v-else class="pane p-10 text-center">
        <p class="text-subheading">{{ learning.loading.value ? '正在整理复习卡…' : '今日没有待复习卡片' }}</p>
        <p class="mt-3 text-body-sm text-stone">学完课节后的知识点、笔记和练习会加入复习。</p>
      </div>
    </template>
    <template v-else>
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
    </template>
  </section>
</template>

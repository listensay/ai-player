<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLearningManagement } from '~/composables/useLearningManagement'
import { useAppDialogs } from '~/composables/useAppDialogs'
import UiButton from './UiButton.vue'
const learning = useLearningManagement()
const dialogs = useAppDialogs()
const router = useRouter()
const pendingOnly = ref(true)
const groups = computed(() => {
  const lessons = new Map<
    string,
    { courseId: string; path: string; title: string; course: string; total: number; pending: number }
  >()
  for (const { courseId, record } of learning.sources.value.practices) {
    if (record.path.startsWith('daily:')) continue
    const course = learning.courses.value.find((c) => c.course.id === courseId)
    if (!course) continue
    const key = JSON.stringify([courseId, record.path])
    const group = lessons.get(key) ?? {
      courseId,
      path: record.path,
      title: record.path.split('/').at(-1) ?? record.path,
      course: course.course.name,
      total: 0,
      pending: 0,
    }
    group.total++
    if (!record.attempts.length) group.pending++
    lessons.set(key, group)
  }
  return [...lessons.values()].filter((g) => !pendingOnly.value || g.pending > 0)
})
async function open(courseId: string, path: string) {
  await router.push({ path: `/courses/${encodeURIComponent(courseId)}/player`, query: { lesson: path, practice: '1' } })
  dialogs.close()
}
</script>
<template>
  <section class="space-y-4" aria-label="练习管理">
    <h2 class="text-heading-sm">练习管理</h2>
    <p class="text-body-sm text-stone">逐字稿完成后自动生成课后练习，未作答的题目会保留在这里。</p>
    <VCheckbox v-model="pendingOnly" label="只看待完成" hide-details />
    <p v-if="learning.state.error" role="alert">{{ learning.state.error }}</p>
    <div
      v-for="group in groups"
      :key="JSON.stringify([group.courseId, group.path])"
      class="pane flex items-center justify-between gap-4 bg-pure-white p-5"
    >
      <div>
        <p class="text-caption text-stone">{{ group.course }}</p>
        <h3 class="text-body font-bold">{{ group.title }}</h3>
        <p class="text-body-sm">
          {{ group.pending ? `待完成 ${group.pending} / ${group.total} 题` : `已完成 ${group.total} 题` }}
        </p>
      </div>
      <UiButton @click="open(group.courseId, group.path)">{{ group.pending ? '开始练习' : '查看练习' }}</UiButton>
    </div>
    <p v-if="!groups.length" class="text-body-sm text-stone">{{ pendingOnly ? '暂无待完成练习' : '暂无课后练习' }}</p>
  </section>
</template>

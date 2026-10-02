<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import { dependencyOverview } from '~/utils/dependencyOverview'
import { conciseLessonTitle } from '~/utils/studyProgram'
import DependencyCourseList from '~/components/DependencyCourseList.vue'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'

const emit = defineEmits<{ select: [path: string] }>()
const guide = useGuide()
const open = ref(false),
  expanded = ref(''),
  showIndirect = ref(false)
const query = ref(''),
  moduleId = ref(''),
  page = ref(1)
const listEl = ref<HTMLElement>()
const PAGE_SIZE = 6
const rows = computed(() =>
  dependencyOverview(guide.state.plan?.lessons ?? [], guide.state.plan?.modules ?? [], guide.risks.value),
)
function title(path: string) {
  return conciseLessonTitle(guide.videoMap.value.get(path)?.title ?? path.split('/').at(-1) ?? path)
}
const groups = computed(() => {
  const counts = new Map<string, number>()
  for (const row of rows.value) counts.set(row.moduleId, (counts.get(row.moduleId) ?? 0) + 1)
  return [...counts].map(([id, count]) => ({ id, title: guide.moduleMap.value.get(id)?.title ?? '其他课节', count }))
})
const moduleItems = computed(() => [
  { title: '全部板块', value: '' },
  ...groups.value.map((group) => ({ title: `${group.title}（${group.count}）`, value: group.id })),
])
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return rows.value.filter(
    (row) =>
      (!moduleId.value || row.moduleId === moduleId.value) &&
      (!q || `${title(row.prerequisite)} ${row.prerequisite}`.toLowerCase().includes(q)),
  )
})
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const currentPage = computed(() => Math.min(page.value, pages.value))
const visible = computed(() => filtered.value.slice((currentPage.value - 1) * PAGE_SIZE, currentPage.value * PAGE_SIZE))
watch([query, moduleId], () => {
  page.value = 1
  expanded.value = ''
})
watch(currentPage, () => {
  expanded.value = ''
})
watch([query, moduleId, currentPage], () => listEl.value?.scrollTo({ top: 0 }), { flush: 'post' })
watch(
  () => guide.state.plan?.createdAt,
  () => {
    open.value = false
    expanded.value = ''
    query.value = ''
    moduleId.value = ''
    page.value = 1
  },
)
watch(expanded, () => {
  showIndirect.value = false
})
watch(groups, (value) => {
  if (moduleId.value && !value.some((group) => group.id === moduleId.value)) moduleId.value = ''
})
function toggle(path: string) {
  expanded.value = expanded.value === path ? '' : path
}
</script>

<template>
  <section
    v-if="rows.length"
    class="min-w-0 rounded-xl border border-brand-orange/30 bg-pure-white p-4"
    aria-label="前置课检查"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h4 class="text-body-sm font-bold">{{ rows.length }} 节前置课未加入路线</h4>
        <p class="mt-1 text-caption text-stone">涉及 {{ groups.length }} 个知识板块</p>
      </div>
      <UiButton size="sm" :disabled="!!guide.state.busy" @click="guide.repairDependencies()">补齐前置课</UiButton>
    </div>
    <button
      type="button"
      class="mt-3 flex w-full items-center justify-between gap-3 rounded-lg bg-page-cream px-3 py-2.5 text-left text-body-sm font-bold"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span>{{ open ? '收起前置关系' : '查看前置关系' }}</span
      ><AppIcon name="chevron-down" :size="16" :class="open ? 'rotate-180' : ''" />
    </button>
    <div v-if="open" class="mt-4 min-w-0 space-y-3">
      <div class="grid gap-3 sm:grid-cols-2">
        <VTextField v-model="query" type="search" label="搜索前置课" density="compact" hide-details />
        <VSelect v-model="moduleId" :items="moduleItems" label="知识板块" hide-details />
      </div>
      <div
        ref="listEl"
        class="scroll-soft max-h-[26rem] min-w-0 overflow-y-auto overscroll-contain rounded-xl border border-linen"
      >
        <ul class="divide-y divide-linen">
          <li v-for="row in visible" :key="row.prerequisite" :data-prerequisite="row.prerequisite" class="p-3 sm:p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="text-caption text-stone">
                  {{ guide.moduleMap.value.get(row.moduleId)?.title ?? '其他课节' }}
                </p>
                <button
                  type="button"
                  class="mt-1 block max-w-full break-words text-left text-body-sm font-bold hover:text-deep-indigo"
                  :title="guide.videoMap.value.get(row.prerequisite)?.title ?? row.prerequisite"
                  @click="emit('select', row.prerequisite)"
                >
                  {{ title(row.prerequisite) }}
                </button>
                <p class="mt-1 text-caption text-stone">
                  直接关联 {{ row.direct.length }} 节<span v-if="row.indirect.length">
                    · 间接影响 {{ row.indirect.length }} 节</span
                  >
                </p>
              </div>
              <UiButton
                size="sm"
                variant="text"
                class="shrink-0"
                :aria-expanded="expanded === row.prerequisite"
                :aria-label="`查看 ${title(row.prerequisite)} 的前置关系`"
                @click="toggle(row.prerequisite)"
                >{{ expanded === row.prerequisite ? '收起' : '查看关系' }}</UiButton
              >
            </div>
            <div v-if="expanded === row.prerequisite" class="mt-3 space-y-3 rounded-lg bg-page-cream p-3">
              <DependencyCourseList
                v-if="row.direct.length"
                :paths="row.direct"
                label="直接依赖此课"
                @select="emit('select', $event)"
              />
              <p v-else class="text-caption text-stone">这节课通过其他前置课与当前路线关联。</p>
              <div v-if="row.indirect.length" class="border-t border-linen pt-3">
                <UiButton
                  size="sm"
                  variant="text"
                  :aria-expanded="showIndirect"
                  @click="showIndirect = !showIndirect"
                  >{{ showIndirect ? '收起间接影响' : `查看间接影响（${row.indirect.length} 节）` }}</UiButton
                >
                <DependencyCourseList
                  v-if="showIndirect"
                  class="mt-2"
                  :paths="row.indirect"
                  label="间接影响的路线课节"
                  @select="emit('select', $event)"
                />
              </div>
            </div>
          </li>
        </ul>
        <p v-if="!visible.length" class="px-4 py-6 text-center text-body-sm text-stone">没有匹配的前置课。</p>
      </div>
      <nav v-if="pages > 1" class="flex flex-wrap items-center justify-between gap-2" aria-label="前置课分页">
        <UiButton size="sm" :disabled="currentPage === 1" aria-label="上一页前置课" @click="page = currentPage - 1"
          >上一页</UiButton
        >
        <span class="text-caption text-stone">第 {{ currentPage }} / {{ pages }} 页 · 共 {{ filtered.length }} 节</span>
        <UiButton size="sm" :disabled="currentPage === pages" aria-label="下一页前置课" @click="page = currentPage + 1"
          >下一页</UiButton
        >
      </nav>
    </div>
  </section>
</template>

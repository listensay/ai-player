<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
import type { VideoEntry } from '~/types/course'
import type { CatalogFolder } from '~/utils/courseCatalog'

const props = defineProps<{
  folder: CatalogFolder
  expanded: Set<string>
  pages: Record<string, number>
  pageSize: number
  filtering: boolean
}>()
const emit = defineEmits<{ toggle: [path: string, open: boolean]; page: [path: string, page: number] }>()
defineSlots<{ video(props: { video: VideoEntry }): unknown }>()
const pageCount = computed(() => Math.max(1, Math.ceil(props.folder.children.length / props.pageSize)))
const page = computed(() => Math.min(props.pages[props.folder.path] ?? 1, pageCount.value))
const visible = computed(() =>
  props.folder.children.slice((page.value - 1) * props.pageSize, page.value * props.pageSize),
)
</script>

<template>
  <div class="catalog-branch min-w-0" :data-folder-content="folder.path">
    <div class="catalog-entries">
      <template v-for="child in visible" :key="child.path">
        <VExpansionPanels
          v-if="child.kind === 'folder'"
          class="catalog-folder course-panels"
          :data-folder="child.path"
          :model-value="filtering || expanded.has(child.path) ? 'content' : undefined"
          :readonly="filtering"
          @update:model-value="emit('toggle', child.path, $event === 'content')"
        >
          <VExpansionPanel value="content">
            <VExpansionPanelTitle :title="child.name">
              <AppIcon name="folder" :size="20" class="mr-3 shrink-0 text-deep-indigo" />
              <span class="min-w-0 flex-1 pr-3">
                <span class="block text-body-sm font-bold text-charcoal-ink [overflow-wrap:anywhere]">{{
                  child.name
                }}</span>
                <span class="mt-1.5 block text-caption font-normal text-stone"
                  >已看 {{ child.done }} / {{ child.videoCount }} 节</span
                >
              </span>
            </VExpansionPanelTitle>
            <VExpansionPanelText>
              <CourseCatalogBranch
                v-if="filtering || expanded.has(child.path)"
                :folder="child"
                :expanded="expanded"
                :pages="pages"
                :page-size="pageSize"
                :filtering="filtering"
                @toggle="(path, open) => emit('toggle', path, open)"
                @page="(path, page) => emit('page', path, page)"
              >
                <template #video="slotProps"><slot name="video" v-bind="slotProps" /></template>
              </CourseCatalogBranch>
            </VExpansionPanelText>
          </VExpansionPanel>
        </VExpansionPanels>
        <slot v-else name="video" :video="child" />
      </template>
    </div>
    <nav
      v-if="pageCount > 1"
      class="mt-5 flex items-center justify-end gap-3"
      :aria-label="`${folder.path ? folder.name : '课程目录'}分页`"
    >
      <UiButton size="sm" :disabled="page === 1" @click="emit('page', folder.path, page - 1)">上一页</UiButton>
      <span class="text-caption tabular font-medium text-stone">{{ page }} / {{ pageCount }}</span>
      <UiButton size="sm" :disabled="page === pageCount" @click="emit('page', folder.path, page + 1)">下一页</UiButton>
    </nav>
  </div>
</template>

<style scoped>
.catalog-entries {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: 16px;
}
.catalog-folder {
  grid-column: 1 / -1;
  min-width: 0;
}
.catalog-folder :deep(.v-expansion-panel-title) {
  padding: 16px;
}
</style>

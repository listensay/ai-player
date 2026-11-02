<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
import CourseCard from '~/components/CourseCard.vue'
import type { LibraryCourse } from '~/types/course'
import type { HomeCourse } from '~/utils/learningHome'
import { searchCourseLibrary } from '~/utils/courseLibrary'

const props = defineProps<{ courses: HomeCourse[]; date: string; changing: string }>()
const emit = defineEmits<{
  open: [course: LibraryCourse, view?: 'overview' | 'player' | 'today']
  update: [course: LibraryCourse, patch: Partial<Pick<LibraryCourse, 'status' | 'pinned'>>]
  rename: [course: LibraryCourse]
  delete: [course: LibraryCourse]
}>()

const query = ref('')
const searchField = ref<{ focus: () => void }>()
const page = ref(1)
function searchCourses() {
  page.value = 1
  searchField.value?.focus()
}

const matching = computed(() => searchCourseLibrary(props.courses, query.value))
const pages = computed(() => Math.max(1, Math.ceil(matching.value.length / 12)))
const currentPage = computed(() => Math.min(page.value, pages.value))
const visible = computed(() => matching.value.slice((currentPage.value - 1) * 12, currentPage.value * 12))
watch(query, () => {
  page.value = 1
})
watch(pages, (value) => {
  page.value = Math.min(page.value, value)
})
</script>

<template>
  <div class="course-library">
    <header class="library-hero">
      <h1 class="text-heading font-bold text-charcoal-ink">网课学习</h1>
      <p class="mt-3 text-body-sm text-stone">让每一次学习，都离目标更近一步。</p>
      <form class="library-search" role="search" @submit.prevent="searchCourses">
        <VTextField
          ref="searchField"
          :model-value="query"
          class="library-search-field"
          type="search"
          placeholder="搜索课程…"
          aria-label="搜索课程"
          variant="solo"
          flat
          rounded="pill"
          density="compact"
          hide-details
          clearable
          @update:model-value="query = $event ?? ''"
        >
          <template #prepend-inner><AppIcon name="search" :size="18" /></template>
        </VTextField>
        <UiButton type="submit" variant="dark" class="library-search-button">搜索</UiButton>
      </form>
    </header>

    <section aria-label="我的课程">
      <div class="mb-4 flex items-center justify-between gap-3 text-caption text-stone">
        <p aria-live="polite">{{ matching.length }} 门课程</p>
        <span>最近学习优先</span>
      </div>
      <div class="library-grid">
        <CourseCard
          v-for="entry in visible"
          :key="entry.course.id"
          :entry="entry"
          :date="date"
          :changing="changing"
          :index="courses.findIndex((course) => course.course.id === entry.course.id)"
          @open="(course, view) => emit('open', course, view)"
          @update="(course, patch) => emit('update', course, patch)"
          @rename="emit('rename', $event)"
          @delete="emit('delete', $event)"
        />
      </div>
      <div v-if="!visible.length" class="library-empty" role="status">
        <AppIcon name="search" :size="28" class="text-stone" />
        <p class="mt-4 text-body-sm text-stone">未找到相关课程</p>
        <UiButton class="mt-5" size="sm" @click="query = ''">清除搜索</UiButton>
      </div>
      <nav v-if="pages > 1" class="mt-6 flex items-center justify-center gap-4" aria-label="课程分页">
        <UiButton size="sm" :disabled="currentPage <= 1" @click="page = currentPage - 1">上一页</UiButton>
        <span class="tabular text-caption text-stone">{{ currentPage }} / {{ pages }}</span>
        <UiButton size="sm" :disabled="currentPage >= pages" @click="page = currentPage + 1">下一页</UiButton>
      </nav>
    </section>
  </div>
</template>

<style scoped>
.course-library {
  container-type: inline-size;
}
.library-hero {
  padding: 32px 0 44px;
  text-align: center;
}
.library-search {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 500px;
  margin: 28px auto 0;
}
.library-search-field {
  min-width: 0;
}
.library-search-field :deep(.v-field) {
  border-radius: var(--radius-pill);
  padding-inline: 16px 10px;
}
.library-search-field :deep(.v-field__input) {
  min-height: 42px;
  font-size: 13px;
}
.library-search-button {
  min-width: 90px;
}
.library-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.library-empty {
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 72px 16px;
  border: 1px dashed var(--color-linen);
  border-radius: var(--radius-3xl);
}
@container (max-width: 440px) {
  .library-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .library-search {
    gap: 6px;
  }
  .library-search-button {
    min-width: 64px;
    padding-inline: 12px;
  }
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import UiButton from './UiButton.vue'
import type { LibraryCourse } from '~/types/course'
import type { HomeCourse } from '~/utils/learningHome'
import { courseLibraryProgress, courseLibraryRemaining, courseLibraryStatus } from '~/utils/courseLibrary'
import { formatStudyDuration } from '~/utils/guide'

const props = withDefaults(
  defineProps<{ entry: HomeCourse; date: string; changing?: string; index?: number; headingTag?: 'h2' | 'h3' }>(),
  { changing: '', index: 0, headingTag: 'h2' },
)
const emit = defineEmits<{
  open: [course: LibraryCourse, view?: 'overview' | 'player' | 'today']
  update: [course: LibraryCourse, patch: Partial<Pick<LibraryCourse, 'status' | 'pinned'>>]
  rename: [course: LibraryCourse]
  delete: [course: LibraryCourse]
}>()
const status = computed(() => courseLibraryStatus(props.entry, props.date))
const progress = computed(() => courseLibraryProgress(props.entry))
const remaining = computed(() => courseLibraryRemaining(props.entry))
const tone = computed(() => ['pink', 'blue', 'yellow', 'green'][props.index % 4])
const statusOptions = [
  { label: '进行中', value: 'active' },
  { label: '已暂停', value: 'paused' },
  { label: '已归档', value: 'archived' },
] as const
</script>

<template>
  <article class="course-card" :class="`course-card--${tone}`">
    <div class="course-card-body">
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <span class="course-status">{{ statusOptions.find((option) => option.value === status)?.label }}</span>
          <span v-if="entry.course.pinned" class="flex items-center gap-1 text-caption text-graphite"
            ><AppIcon name="pin" :size="12" />置顶</span
          >
        </div>
        <VMenu>
          <template #activator="{ props: menuProps }">
            <UiButton
              v-bind="menuProps"
              icon
              variant="text"
              size="sm"
              :title="`${entry.course.name}的课程操作`"
              :disabled="!!changing"
            >
              <AppIcon name="more" :size="18" />
            </UiButton>
          </template>
          <VList>
            <VListItem title="查看课程" @click="emit('open', entry.course)" />
            <VListItem title="重命名" @click="emit('rename', entry.course)" />
            <VListItem
              v-if="entry.course.status === 'active'"
              :title="status === 'paused' ? '恢复计划' : '安排学习'"
              @click="emit('open', entry.course, 'today')"
            />
            <VListItem
              :title="entry.course.pinned ? '取消置顶' : '置顶课程'"
              @click="emit('update', entry.course, { pinned: !entry.course.pinned })"
            />
            <VListItem
              v-if="entry.course.status === 'active'"
              title="暂停课程"
              @click="emit('update', entry.course, { status: 'paused' })"
            />
            <VListItem v-else title="恢复课程" @click="emit('update', entry.course, { status: 'active' })" />
            <VListItem
              v-if="entry.course.status !== 'archived'"
              title="归档课程"
              @click="emit('update', entry.course, { status: 'archived' })"
            />
            <VListItem title="删除课程" class="text-error" @click="emit('delete', entry.course)" />
          </VList>
        </VMenu>
      </div>

      <component :is="headingTag" class="mt-4 text-subheading font-bold text-charcoal-ink">
        <button type="button" class="course-title" :title="entry.course.name" @click="emit('open', entry.course)">
          {{ entry.course.name }}
        </button>
      </component>
      <p class="course-description tabular">
        {{
          remaining
            ? `视频剩余${remaining.estimated ? '约' : ''} ${formatStudyDuration(remaining.seconds)}`
            : '视频剩余时长待获取'
        }}
      </p>
      <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-charcoal-ink">
        <span class="flex items-center gap-1.5"
          ><AppIcon name="film" :size="15" />{{ entry.course.videoCount }} 节课</span
        >
        <span v-if="entry.context?.plan?.modules.length" class="flex items-center gap-1.5"
          ><AppIcon name="route" :size="15" />{{ entry.context.plan.modules.length }} 个阶段</span
        >
      </div>

      <div v-if="progress" class="course-progress">
        <div class="mb-2 flex items-center justify-between text-caption">
          <span class="text-graphite">学习进度</span>
          <span class="tabular font-bold">{{ progress.percent }}%</span>
        </div>
        <div
          class="course-progress-track"
          role="progressbar"
          :aria-label="`${entry.course.name}观看进度`"
          :aria-valuenow="progress.percent"
          :aria-valuemin="0"
          :aria-valuemax="100"
        >
          <div class="course-progress-fill" :style="{ width: `${progress.percent}%` }" />
        </div>
      </div>
      <p v-else class="mt-auto pt-6 text-caption text-error" role="alert">
        {{ entry.error || '学习记录暂不可用' }}
      </p>
    </div>
    <footer class="course-card-footer">
      <span class="tabular text-caption text-stone">{{
        progress ? `已完成 ${progress.done} / ${entry.course.videoCount} 节` : `${entry.course.videoCount} 节课`
      }}</span>
      <UiButton
        size="sm"
        variant="dark"
        @click="emit('open', entry.course, status === 'active' && progress?.state !== 'done' ? 'player' : 'overview')"
      >
        {{
          status !== 'active'
            ? '查看课程'
            : progress?.state === 'done'
              ? '回顾课程'
              : progress?.state === 'new'
                ? '开始学习'
                : '继续学习'
        }}
      </UiButton>
    </footer>
  </article>
</template>

<style scoped>
.course-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 5px 5px 0;
  border: 1px solid transparent;
  border-radius: 22px;
  background: var(--color-pure-white);
  transition: border-color 160ms;
}
.course-card:hover,
.course-card:focus-within {
  border-color: var(--color-driftwood);
}
.course-card--pink {
  --course-tint: color-mix(in srgb, var(--color-blush) 32%, var(--color-pure-white));
}
.course-card--blue {
  --course-tint: color-mix(in srgb, var(--color-celeste) 12%, var(--color-pure-white));
}
.course-card--yellow {
  --course-tint: color-mix(in srgb, var(--color-sunbeam-yellow) 19%, var(--color-pure-white));
}
.course-card--green {
  --course-tint: color-mix(in srgb, var(--color-study-complete) 14%, var(--color-pure-white));
}
.course-card-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 260px;
  padding: 16px 20px 20px;
  border-radius: 17px;
  background: var(--course-tint);
}
.course-status {
  border-radius: var(--radius-pill);
  padding: 4px 10px;
  background: color-mix(in srgb, var(--color-charcoal-ink) 5%, transparent);
  font-size: 11px;
  white-space: nowrap;
}
.course-title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  text-align: left;
  overflow-wrap: anywhere;
}
.course-description {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  min-height: 36px;
  margin-top: 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--color-graphite);
  overflow-wrap: anywhere;
}
.course-progress {
  margin-top: auto;
  padding-top: 26px;
}
.course-progress-track {
  height: 5px;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--color-charcoal-ink) 12%, transparent);
}
.course-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--color-charcoal-ink);
  transition: width 200ms;
}
.course-card-footer {
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 15px;
}
.course-card-footer :deep(.ui-button) {
  font-size: 12px;
  font-weight: 500;
  box-shadow: none;
}
@container (max-width: 580px) {
  .course-card-body {
    padding-inline: 14px;
  }
  .course-card-footer {
    flex-wrap: wrap;
    padding-inline: 10px;
  }
}
</style>

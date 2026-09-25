<script setup lang="ts">
import { ref } from 'vue'
import { useCourseStore } from '~/composables/useCourseStore'
import { useProgress } from '~/composables/useProgress'
import { formatRelative } from '~/utils/time'
import { useRouter } from 'vue-router'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
const router = useRouter()
/**
 * 欢迎页：还没打开课程时的入口。
 * 唯一的蓝色按钮 = 打开课程文件夹；最近打开的课程以白色卡片列出，一键恢复。
 */
import type { RecentCourse } from '~/types/course'

const store = useCourseStore()
const progress = useProgress()
const busyId = ref<string | null>(null)

async function reopen(recent: RecentCourse) {
  busyId.value = recent.id
  try {
    if (await store.reopenRecent(recent)) await router.push(`/courses/${store.state.course!.id}`)
  } finally {
    busyId.value = null
  }
}

async function openFolder() {
  if (await store.openFolder()) await router.push(`/courses/${store.state.course!.id}`)
}

function doneCount(recent: RecentCourse) {
  const map = progress.courseProgress(recent.id)
  return Object.values(map).filter((p) => p.done).length
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-4xl flex-col items-center px-6 py-16 md:py-24">
    <!-- 品牌图形：橙色 logo 点 + 黄/靛蓝的圆润形状，呼应"插画感"的品牌气质 -->
    <div class="relative h-24 w-40" aria-hidden="true">
      <span class="absolute top-4 left-2 h-16 w-16 rounded-full bg-sunbeam-yellow" />
      <span class="absolute top-0 right-6 h-24 w-14 rounded-full bg-deep-indigo" />
      <span class="absolute bottom-2 right-0 h-10 w-10 rounded-full bg-blush" />
      <span class="absolute top-10 left-16 h-7 w-7 rounded-full bg-brand-orange ring-4 ring-page-cream" />
    </div>

    <h1 class="mt-10 max-w-2xl text-center text-heading-lg font-bold text-charcoal-ink md:text-display">
      本地课程学习与规划
    </h1>
    <p class="mt-5 max-w-xl text-center text-body text-graphite">
      播放课程、记录笔记，通过 AI 规划学习路线。
    </p>

    <div class="mt-8 flex flex-col items-center gap-3">
      <UiButton
        variant="primary"
        size="lg"
        :disabled="store.state.loading"
        @click="openFolder"
      >
        <AppIcon name="folder" :size="20" />
        {{ store.state.loading ? '正在读取…' : '打开课程文件夹' }}
      </UiButton>
      <p class="text-caption text-stone">支持 MP4、WebM、MKV、MOV 等格式，子文件夹按章节展示</p>
    </div>

    <p
      v-if="store.state.error"
      role="alert"
      class="mt-6 max-w-lg rounded-xl border border-linen bg-pure-white px-4 py-3 text-center text-body-sm text-error"
    >
      {{ store.state.error }}
    </p>

    <p v-if="store.state.accessWarning" role="status" class="mt-4 max-w-lg text-center text-caption text-stone">{{ store.state.accessWarning }}</p>

    <section v-if="store.state.recents.length" class="mt-16 w-full max-w-2xl" aria-label="最近打开">
      <h2 class="text-body font-bold">最近打开</h2>
      <ul class="mt-3 grid gap-3 sm:grid-cols-2">
        <li v-for="recent in store.state.recents" :key="recent.id" class="group relative">
          <button
            type="button"
            class="pane flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-cream-deep disabled:opacity-60"
            :disabled="busyId !== null || store.state.loading"
            @click="reopen(recent)"
          >
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sunbeam-yellow text-charcoal-ink">
              <AppIcon name="folder" :size="20" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-body font-bold">{{ recent.name }}</span>
              <span class="tabular block text-caption text-stone">
                共 {{ recent.videoCount }} 节 · 已完成 {{ doneCount(recent) }} 节 · 上次打开：{{ formatRelative(recent.lastOpenedAt) }}
              </span>
            </span>
            <AppIcon name="chevron-right" :size="18" class="shrink-0 text-stone" />
          </button>
          <button
            type="button"
            class="absolute top-1/2 right-11 -translate-y-1/2 rounded-full p-1.5 text-stone opacity-0 transition-opacity hover:bg-linen hover:text-charcoal-ink focus-visible:opacity-100 group-hover:opacity-100"
            :title="`从最近列表移除「${recent.name}」`"
            @click.stop="store.removeRecent(recent)"
          >
            <AppIcon name="close" :size="14" />
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

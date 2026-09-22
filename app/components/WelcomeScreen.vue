<script setup lang="ts">
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
    await store.reopenRecent(recent)
  } finally {
    busyId.value = null
  }
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
      把上百集的教程，看成你自己的小课。
    </h1>
    <p class="mt-5 max-w-xl text-center text-body text-graphite">
      打开本地课程文件夹，边看边记。笔记里的每个时间点都能跳回视频，截图和进度都留在你自己的电脑上。
    </p>

    <div class="mt-8 flex flex-col items-center gap-3">
      <UiButton
        variant="primary"
        size="lg"
        :disabled="!store.state.supported || store.state.loading"
        @click="store.openFolder()"
      >
        <AppIcon name="folder" :size="20" />
        {{ store.state.loading ? '正在读取…' : '打开课程文件夹' }}
      </UiButton>
      <p v-if="!store.state.supported" class="max-w-md text-center text-body-sm text-error">
        当前浏览器不支持直接读写本地文件夹。请用 Chrome 或 Edge 打开这个页面。
      </p>
      <p v-else class="text-caption text-stone">支持 mp4、webm、mkv、mov 等格式，子文件夹会作为章节展示</p>
    </div>

    <p
      v-if="store.state.error"
      role="alert"
      class="mt-6 max-w-lg rounded-xl border border-linen bg-pure-white px-4 py-3 text-center text-body-sm text-error"
    >
      {{ store.state.error }}
    </p>

    <section v-if="store.state.recents.length" class="mt-16 w-full max-w-2xl" aria-label="最近打开">
      <h2 class="text-body font-bold">最近打开</h2>
      <ul class="mt-3 grid gap-3 sm:grid-cols-2">
        <li v-for="recent in store.state.recents" :key="recent.id" class="group relative">
          <button
            type="button"
            class="pane flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-cream-deep disabled:opacity-60"
            :disabled="busyId !== null"
            @click="reopen(recent)"
          >
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sunbeam-yellow text-charcoal-ink">
              <AppIcon name="folder" :size="20" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-body font-bold">{{ recent.name }}</span>
              <span class="tabular block text-caption text-stone">
                {{ recent.videoCount }} 集，已看完 {{ doneCount(recent) }} 集。{{ formatRelative(recent.lastOpenedAt) }}打开过
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
      <p class="mt-3 text-caption text-stone">重新打开时浏览器会再确认一次文件夹访问权限。</p>
    </section>
  </div>
</template>

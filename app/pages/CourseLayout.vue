<script setup lang="ts">
import { computed } from 'vue'

import { useCourseStore } from '~/composables/useCourseStore'
import { useRoute } from 'vue-router'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'
import { RouterLink } from 'vue-router'
import { RouterView } from 'vue-router'
const store = useCourseStore()
const route = useRoute()
const ready = computed(() => !store.state.loading && store.state.course?.id === route.params.id)
const recent = computed(() => store.state.accessRecent)
async function connect(replaceHandle = false) {
  if (recent.value) await store.reopenRecent(recent.value, replaceHandle)
}
</script>

<template>
  <RouterView v-if="ready" v-slot="{ Component }">
    <component :is="Component" :key="`${route.params.id}:${String(route.name)}`" />
  </RouterView>
  <main v-else class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-12">
    <section class="pane w-full max-w-lg p-8 text-center" aria-live="polite">
      <AppIcon name="folder" :size="32" class="mx-auto text-deep-indigo" />
      <h1 class="mt-5 text-heading font-bold">{{ store.state.loading ? '正在恢复课程…' : recent ? recent.name : '无法打开课程' }}</h1>
      <p v-if="!store.state.loading && recent" class="mt-3 text-body-sm text-graphite">
        课程目录已移动或无法访问，请重新关联原文件夹。
      </p>
      <p v-if="store.state.error" role="alert" class="mt-4 text-body-sm text-error">{{ store.state.error }}</p>
      <div v-if="!store.state.loading" class="mt-6 flex flex-wrap items-center justify-center gap-3">
        <UiButton v-if="recent" @click="connect(true)">关联课程文件夹</UiButton>
        <UiButton v-if="!recent" variant="ghost" @click="store.restoreCourse(String(route.params.id))">重试</UiButton>
        <RouterLink to="/" class="rounded-full px-4 py-2 text-body-sm font-bold hover:text-deep-indigo">返回首页</RouterLink>
      </div>
    </section>
  </main>
</template>

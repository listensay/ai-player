<script setup lang="ts">
import { computed } from 'vue'
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'
import PracticeText from '~/components/PracticeText.vue'

const { course, video, knowledge, transcripts, guide, openGuide, openPractice, rightTab } = useCourseWorkspace()
const state = computed(() => course.value && video.value ? knowledge.get(course.value.id, video.value.path) : null)
const transcript = computed(() => course.value && video.value ? transcripts.get(course.value.id, video.value.path) : null)
const busy = computed(() => !!state.value && ['loading', 'transcribing', 'generating'].includes(state.value.status))
const progress = computed(() => {
  if (state.value?.status === 'generating') return `正在整理知识点 ${state.value.progress}`
  if (state.value?.status === 'transcribing') {
    const download = transcripts.asr.state.health?.download
    if (download?.total) return `正在下载转写模型 ${Math.round(download.received / download.total * 100)}%`
    return transcript.value?.progress != null ? `正在转写 ${Math.round(transcript.value.progress * 100)}%` : '正在准备逐字稿…'
  }
  return '正在读取知识点…'
})
function retry(force = false) {
  if (course.value && video.value) void knowledge.ensure(course.value.id, video.value, undefined, force).catch(() => {})
}
function cancel() { if (course.value && video.value) knowledge.cancel(course.value.id, video.value.path) }
</script>

<template>
  <section class="scroll-soft min-h-0 flex-1 overflow-y-auto p-4" aria-label="本课知识点">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 class="flex items-center gap-2 text-body font-bold"><AppIcon name="sparkles" :size="18" />知识点总结</h2>
      <UiButton v-if="state?.summary" variant="text" size="sm" :disabled="busy" @click="retry(true)">重新整理</UiButton>
    </div>
    <div v-if="busy" role="status" class="mb-4 rounded-2xl bg-sunbeam-yellow/15 p-4">
      <p class="text-body-sm">{{ progress }}</p>
      <UiButton variant="text" size="sm" class="mt-2" @click="cancel">取消</UiButton>
    </div>
    <div v-if="state?.error" class="mb-4 flex flex-col gap-2">
      <p role="alert" class="text-body-sm text-error">{{ state.error }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <UiButton v-if="!guide.configured.value" size="sm" @click="openGuide('settings')">AI 设置</UiButton>
        <UiButton v-else size="sm" :disabled="busy" @click="retry()">继续整理</UiButton>
        <UiButton v-if="guide.configured.value" variant="text" size="sm" :disabled="busy" @click="retry(true)">从头整理</UiButton>
      </div>
    </div>
    <div v-if="state?.storageError" class="mb-4">
      <p role="alert" class="text-body-sm text-error">{{ state.storageError }}</p>
      <UiButton size="sm" variant="ghost" class="mt-2" @click="course && video && knowledge.retrySave(course.id, video.path)">重试保存</UiButton>
    </div>
    <article v-if="state?.summary" class="space-y-5" aria-label="整课知识总结">
      <section class="border-b border-linen pb-5">
        <h3 class="mb-3 text-body-sm font-bold">本课概览</h3>
        <PracticeText :text="state.summary.overview" class="text-body-sm text-graphite" />
      </section>
      <ol class="space-y-5">
      <li v-for="(point, index) in state.summary.points" :key="point.id">
        <div class="mb-3 flex items-start gap-2">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunbeam-yellow text-caption font-bold">{{ index + 1 }}</span>
          <h3 class="text-body-sm font-bold">{{ point.title }}</h3>
        </div>
        <PracticeText :text="point.text" class="text-body-sm text-graphite" />
      </li>
      </ol>
    </article>
    <UiButton v-if="state?.summary" class="mt-5 w-full" :disabled="busy" @click="openPractice()">练习本课知识点</UiButton>
    <div class="mt-5 border-t border-linen pt-3 text-caption text-stone">
      <p>逐字稿将自动发送至所选 AI 服务整理知识点，视频和音频在本地处理。</p>
      <UiButton variant="text" size="sm" class="mt-2" @click="rightTab = 'transcript'">查看逐字稿</UiButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import { formatTime } from '~/utils/time'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'
import PracticeText from '~/components/PracticeText.vue'

const { course, video, knowledge, transcripts, guide, openGuide, openPractice, seekTo, rightTab } = useCourseWorkspace()
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
function retry() {
  if (course.value && video.value) void knowledge.ensure(course.value.id, video.value, undefined, true).catch(() => {})
}
function cancel() { if (course.value && video.value) knowledge.cancel(course.value.id, video.value.path) }
</script>

<template>
  <section class="scroll-soft min-h-0 flex-1 overflow-y-auto p-4" aria-label="本课知识点">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 class="flex items-center gap-2 text-body font-bold"><AppIcon name="sparkles" :size="18" />知识点总结</h2>
      <UiButton v-if="state?.summary" variant="text" size="sm" :disabled="busy" @click="retry">重新整理</UiButton>
    </div>
    <div v-if="busy" role="status" class="mb-4 rounded-2xl bg-sunbeam-yellow/15 p-4">
      <p class="text-body-sm">{{ progress }}</p>
      <UiButton variant="text" size="sm" class="mt-2" @click="cancel">取消</UiButton>
    </div>
    <div v-if="state?.error" class="mb-4 space-y-2">
      <p role="alert" class="text-body-sm text-error">{{ state.error }}</p>
      <UiButton v-if="!guide.configured.value" size="sm" @click="openGuide(undefined, 'settings')">AI 设置</UiButton>
      <UiButton v-else size="sm" :disabled="busy" @click="retry">重试</UiButton>
    </div>
    <p v-if="state?.storageError" role="alert" class="mb-4 text-body-sm text-error">{{ state.storageError }}</p>
    <ol v-if="state?.summary" class="space-y-4">
      <li v-for="(point, index) in state.summary.points" :key="point.id" class="rounded-2xl border border-linen p-4">
        <div class="mb-3 flex items-start gap-2">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunbeam-yellow text-caption font-bold">{{ index + 1 }}</span>
          <h3 class="text-body-sm font-bold">{{ point.title }}</h3>
        </div>
        <PracticeText :text="point.text" class="text-body-sm text-graphite" />
        <button type="button" class="mt-3 text-caption font-bold text-deep-indigo" @click="seekTo(point.start)">回看 {{ formatTime(point.start, true) }}–{{ formatTime(point.end, true) }}</button>
      </li>
    </ol>
    <UiButton v-if="state?.summary" class="mt-5 w-full" :disabled="busy" @click="openPractice()">练习本课知识点</UiButton>
    <div class="mt-5 border-t border-linen pt-3 text-caption text-stone">
      <p>逐字稿将自动发送至所选 AI 服务整理知识点，视频和音频在本地处理。</p>
      <UiButton variant="text" size="sm" class="mt-2" @click="rightTab = 'transcript'">查看逐字稿</UiButton>
    </div>
  </section>
</template>

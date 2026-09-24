<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import { formatTime } from '~/utils/time'
import UiButton from '~/components/UiButton.vue'
import { QUESTION_LABELS } from '~/utils/learningFeedback'
defineEmits<{ select: [id: string]; seek: [path: string, seconds: number] }>()
const guide = useGuide()
const filter = ref<'open' | 'resolved' | 'all'>('open')
const questions = computed(() => guide.state.questions.filter(q => filter.value === 'all'
  || (filter.value === 'open' ? q.status !== 'resolved' : q.status === 'resolved')))
</script>

<template>
  <section class="pane p-5" aria-label="疑问清单">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-subheading">疑问清单 <span class="text-body-sm text-stone">{{ guide.unresolvedQuestions.value.length }} 个待解决</span></h3>
      <select v-model="filter" aria-label="筛选疑问状态" class="rounded-full border border-linen bg-page-cream px-3 py-2 text-caption">
        <option value="open">待解决</option><option value="resolved">已解决</option><option value="all">全部疑问</option>
      </select>
    </div>
    <p class="mt-2 text-caption leading-relaxed text-stone">记录课节与提问位置。回看后选择“仍不理解”，会将回看过的基础课加入补学；解决疑问不会自动标记知识已掌握。</p>
    <ul class="mt-3 divide-y divide-linen">
      <li v-for="q in questions" :key="q.id" class="py-4" :data-question-id="q.id">
        <div class="flex items-start justify-between gap-3">
          <p class="min-w-0 whitespace-pre-wrap break-words text-body-sm font-bold">{{ q.text }}</p>
          <span class="shrink-0 rounded-full bg-page-cream px-2 py-1 text-caption">{{ QUESTION_LABELS[q.status] }}</span>
        </div>
        <button type="button" class="mt-2 max-w-full break-words text-left text-caption text-stone underline" @click="$emit('seek', q.path, q.seconds)">
          {{ guide.videoMap.value.get(q.path)?.title }} · {{ formatTime(q.seconds, true) }} · 返回提问位置
        </button>
        <div class="mt-3 flex flex-wrap gap-2">
          <UiButton size="sm" :disabled="!!guide.state.busy" @click="$emit('select', q.id)">继续处理</UiButton>
          <UiButton v-if="q.status !== 'resolved'" size="sm" :disabled="!!guide.state.busy" @click="guide.setQuestionStatus(q.id, 'resolved')">标记已解决</UiButton>
          <UiButton v-if="q.status !== 'resolved'" variant="text" size="sm" :disabled="!!guide.state.busy" @click="guide.setQuestionStatus(q.id, 'still-confused')">仍不理解</UiButton>
          <UiButton v-else variant="text" size="sm" :disabled="!!guide.state.busy" @click="guide.setQuestionStatus(q.id, 'open')">重新打开</UiButton>
        </div>
      </li>
    </ul>
    <p v-if="!questions.length" class="py-6 text-center text-body-sm text-stone">{{ filter === 'resolved' ? '暂无已解决的疑问' : filter === 'all' ? '暂无疑问记录。可在笔记中选中问题并记录。' : '暂无待解决的疑问' }}</p>
  </section>
</template>

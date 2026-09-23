<script setup lang="ts">
import type { MasteryLevel } from '~/types/guide'
import { masteryKey } from '~/utils/learningFeedback'

const props = defineProps<{ practice: ReturnType<typeof useLessonPractice> }>()
const emit = defineEmits<{ settings: []; seek: [path: string, seconds: number]; help: [question: string] }>()
const { state, current, history, sources, configured, hasMaterial } = props.practice
const guide = useGuide()
const dialog = ref<HTMLDialogElement>()
const feedbackEl = ref<HTMLElement>()
const attemptIndex = ref(0)
const attempt = computed(() => current.value?.attempts[attemptIndex.value])
const labels = { explain: '解释一遍', code: '写一小段代码', task: '动手小任务' }
const results = { solid: '这次回答比较完整', partial: '理解已有基础，再补一点', retry: '这个知识点值得再练一次' }
const sourceLabels = { note: '本课笔记', subtitle: '字幕', supplement: '补充材料' }
watch(() => state.open, async open => { await nextTick(); if (open) { if (!dialog.value?.open) dialog.value?.showModal() } else dialog.value?.close() })
watch(() => [current.value?.id, current.value?.attempts.length], () => { attemptIndex.value = Math.max(0, (current.value?.attempts.length ?? 1) - 1) })
watch(() => current.value?.attempts.length, async (count, previous) => {
  if (count && count > (previous ?? 0) && state.open) { await nextTick(); feedbackEl.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }
})
function mark(concept: string, event: Event) {
  if (current.value) guide.setPracticeMastery(current.value.path, [concept], (event.target as HTMLSelectElement).value as MasteryLevel | '')
}
function help() {
  const question = current.value?.question.prompt
  if (!question) return
  props.practice.close(); emit('help', `这道练习还有疑问：${question}`.slice(0, 3000))
}
</script>

<template>
  <dialog ref="dialog" aria-labelledby="practice-title"
    class="m-auto h-[min(90dvh,900px)] w-[min(96vw,840px)] max-w-none overflow-hidden rounded-3xl border border-linen bg-page-cream p-0 text-charcoal-ink shadow-float backdrop:bg-charcoal-ink/40"
    @cancel.prevent="practice.close()" @close="state.open && practice.close()" @click="($event.target === dialog) && practice.close()">
    <div class="flex h-full min-w-0 flex-col">
      <header class="flex shrink-0 items-center justify-between gap-3 border-b border-linen bg-pure-white px-5 py-4">
        <div class="min-w-0"><h2 id="practice-title" class="text-subheading">学完一小练</h2><p class="mt-1 truncate text-caption text-stone">{{ state.title }} · 用 2–5 分钟检验理解</p></div>
        <UiButton variant="text" size="sm" icon title="关闭练习" @click="practice.close()"><AppIcon name="close" :size="20" /></UiButton>
      </header>
      <div class="scroll-soft min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
        <div class="flex flex-wrap items-center justify-between gap-2 text-caption text-stone">
          <p>新题范围：{{ state.scope ? `${formatTime(state.scope.start, true)}–${formatTime(state.scope.end, true)}` : '本课内容' }}</p>
          <button type="button" class="font-bold underline" @click="practice.close(); emit('settings')">AI 设置</button>
        </div>
        <p v-if="state.storageError" role="alert" class="rounded-xl bg-sunbeam-yellow/20 p-3 text-body-sm">{{ state.storageError }}</p>
        <details class="rounded-2xl border border-linen bg-pure-white p-4" :open="!current">
          <summary class="cursor-pointer text-body-sm font-bold">出题材料 · {{ sources.filter(s => s.kind === 'subtitle').length }} 段字幕 / {{ sources.some(s => s.kind === 'note') ? '有笔记' : '无笔记' }}{{ sources.some(s => s.kind === 'supplement') ? ' / 有补充' : '' }}</summary>
          <div class="mt-3 space-y-3">
            <p class="text-caption leading-relaxed text-stone">主动生成时，将选取的字幕、本课笔记文字和补充材料发送给你配置的 AI；提交作答时另发送题目和答案。最多选取 12000 字，不发送视频和图片。笔记含当前尚未保存的文字。</p>
            <p v-if="state.materialNotice" class="text-body-sm text-stone">{{ state.materialNotice }}</p>
            <p v-if="!hasMaterial && state.busy !== 'loading'" class="text-body-sm font-medium">学习材料不足。请添加同名 SRT/VTT 字幕、写下笔记，或补充本次学到的概念与示例。</p>
            <label class="block text-body-sm font-bold">补充学习内容
              <textarea v-model="state.supplement" aria-label="补充学习内容" maxlength="4000" rows="4" :disabled="!!state.busy"
                placeholder="例如：老师解释了什么概念？给出了什么示例？也可以粘贴代码。"
                class="mt-2 block w-full resize-y rounded-xl border border-linen bg-page-cream p-3 text-body-sm font-normal" />
            </label>
            <details v-if="sources.length" class="text-caption">
              <summary class="cursor-pointer font-bold">查看将发送的材料（{{ sources.reduce((n, s) => n + s.text.length, 0) }} 字）</summary>
              <div v-for="source in sources" :key="source.id" class="mt-3 border-t border-linen pt-3">
                <p class="font-bold">{{ sourceLabels[source.kind] }} {{ source.start !== undefined ? formatTime(source.start, true) : '' }}</p>
                <p class="mt-1 whitespace-pre-wrap break-words text-graphite">{{ source.text }}</p>
              </div>
            </details>
          </div>
        </details>
        <div class="flex flex-wrap items-center gap-3">
          <UiButton :disabled="!!state.busy || !configured" @click="practice.generate()">{{ current ? '换一道题' : '生成一小练' }}</UiButton>
          <span v-if="!configured" class="text-caption text-stone">先填写 AI 服务与模型，即可出题。</span>
          <span v-if="state.busy" role="status" class="text-body-sm">{{ state.busy === 'loading' ? '正在读取本地材料…' : state.busy === 'generate' ? '正在准备练习…' : '正在查看你的作答…' }}</span>
          <button v-if="state.busy" type="button" class="text-caption underline" @click="practice.cancel()">取消请求</button>
        </div>
        <p v-if="state.error" role="alert" class="rounded-xl border border-error/20 bg-error/5 p-3 text-body-sm text-error">{{ state.error }}</p>
        <label v-if="history.length" class="block text-caption font-bold">本课练习记录
          <select :value="state.selectedId" aria-label="本课练习记录" :disabled="!!state.busy" class="mt-2 block w-full min-w-0 rounded-xl border border-linen bg-pure-white p-3 text-body-sm" @change="practice.select(($event.target as HTMLSelectElement).value)">
            <option value="">准备新练习</option>
            <option v-for="record in history" :key="record.id" :value="record.id">{{ new Date(record.createdAt).toLocaleString() }} · {{ record.question.prompt.slice(0, 45) }}</option>
          </select>
        </label>
        <section v-if="current" :key="current.id" class="space-y-4 rounded-2xl border border-linen bg-pure-white p-4 sm:p-5" aria-label="当前练习">
          <p class="text-caption font-bold text-stone">{{ labels[current.question.kind] }} · {{ current.scope ? `${formatTime(current.scope.start, true)}–${formatTime(current.scope.end, true)}` : '本课内容' }}</p>
          <h3 class="whitespace-pre-wrap break-words text-body font-bold leading-relaxed">{{ current.question.prompt }}</h3>
          <ul class="list-inside list-disc space-y-1 text-body-sm text-graphite"><li v-for="criterion in current.question.criteria" :key="criterion">{{ criterion }}</li></ul>
          <label class="block text-body-sm font-bold">你的作答
            <textarea :value="current.draft" aria-label="你的作答" maxlength="8000" rows="6" :disabled="!!state.busy" placeholder="先用自己的话解释，也可以直接写代码。代码不会被执行。"
              class="mt-2 block w-full resize-y rounded-xl border border-linen bg-page-cream p-3 font-mono text-body-sm font-normal" @input="practice.updateDraft(($event.target as HTMLTextAreaElement).value)" />
          </label>
          <div class="flex flex-wrap items-center gap-3">
            <UiButton variant="dark" :disabled="!!state.busy || current.attempts.length >= 3 || !configured" @click="practice.review()">提交作答，看看反馈</UiButton>
            <p class="text-caption text-stone">本题已反馈 {{ current.attempts.length }}/3 次 · 草稿自动保存在本浏览器</p>
          </div>
          <p v-if="current.attempts.length >= 3" class="text-caption text-stone">可以参考反馈继续修改草稿，或换一道题巩固。</p>
          <section v-if="attempt" ref="feedbackEl" aria-label="答题反馈" class="space-y-3 rounded-xl bg-page-cream p-4">
            <label class="text-caption">查看反馈
              <select v-model.number="attemptIndex" aria-label="查看第几次反馈" class="ml-2 rounded-lg border border-linen bg-pure-white p-2"><option v-for="(_, index) in current.attempts" :key="index" :value="index">第 {{ index + 1 }} 次</option></select>
            </label>
            <p class="text-body font-bold">{{ results[attempt.feedback.result] }}</p>
            <div v-if="attempt.feedback.strengths.length"><p class="text-caption font-bold">答对的部分</p><ul class="mt-1 list-inside list-disc space-y-1 text-body-sm"><li v-for="s in attempt.feedback.strengths" :key="s">{{ s }}</li></ul></div>
            <div v-if="attempt.feedback.gaps.length"><p class="text-caption font-bold">再补充一点</p><ul class="mt-1 list-inside list-disc space-y-1 text-body-sm"><li v-for="gap in attempt.feedback.gaps" :key="gap">{{ gap }}</li></ul></div>
            <p class="whitespace-pre-wrap break-words text-body-sm"><strong>下一步：</strong>{{ attempt.feedback.nextStep }}</p>
            <details class="text-caption"><summary class="cursor-pointer">本次提交的答案</summary><pre class="mt-2 whitespace-pre-wrap break-words">{{ attempt.answer }}</pre></details>
            <p class="text-caption text-stone">反馈供自查，不代表整课已掌握。请按自己的理解标记本题知识点：</p>
            <label v-for="concept in current.question.concepts" :key="concept" class="flex flex-wrap items-center justify-between gap-2 text-body-sm">
              {{ concept }}
              <select :value="guide.state.mastery[masteryKey(current.path, concept)]?.level ?? ''" :aria-label="`练习知识点 ${concept} 掌握程度`" :disabled="!!guide.state.busy"
                class="rounded-lg border border-linen bg-pure-white p-2" @change="mark(concept, $event)"><option value="">未标记</option><option value="mastered">已掌握</option><option value="uncertain">不确定</option><option value="needs-review">需要补学</option></select>
            </label>
            <button type="button" class="text-body-sm font-bold underline" @click="help">还有疑问，找基础</button>
          </section>
          <details class="rounded-xl border border-linen p-3 text-body-sm"><summary class="cursor-pointer font-bold">参考答案</summary><pre class="mt-3 whitespace-pre-wrap break-words font-sans leading-relaxed">{{ current.question.referenceAnswer }}</pre></details>
          <details class="rounded-xl border border-linen p-3 text-body-sm">
            <summary class="cursor-pointer font-bold">题目与反馈的依据</summary>
            <div v-for="source in current.sources.filter(s => current!.question.sourceIds.includes(s.id) || attempt?.feedback.sourceIds.includes(s.id))" :key="source.id" class="mt-3 border-t border-linen pt-3">
              <p class="text-caption font-bold">{{ sourceLabels[source.kind] }}<button v-if="source.start !== undefined" type="button" class="ml-2 underline" @click="practice.close(); emit('seek', current.path, source.start)">回看 {{ formatTime(source.start, true) }}–{{ formatTime(source.end!, true) }}</button></p>
              <p class="mt-2 whitespace-pre-wrap break-words leading-relaxed text-graphite">{{ source.text }}</p>
            </div>
          </details>
        </section>
        <p class="text-caption text-stone">每门课保留最近 20 道练习及每题最多 3 次反馈；清除浏览器数据会删除记录。</p>
      </div>
    </div>
  </dialog>
</template>

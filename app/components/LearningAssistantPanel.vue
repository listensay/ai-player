<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import UiButton from './UiButton.vue'
import AppIcon from './AppIcon.vue'
import PracticeText from './PracticeText.vue'
const workspace = useCourseWorkspace()
const a = reactive(workspace.assistant)
const historyOpen = ref(false),
  historySearch = ref(''),
  historyLimit = ref(20)
const filteredHistory = computed(() => {
  const query = historySearch.value.trim().toLowerCase()
  return a.conversations.filter(
    (session) => !query || `${session.title} ${session.videoTitle} ${session.courseName}`.toLowerCase().includes(query),
  )
})
watch(historySearch, () => {
  historyLimit.value = 20
})
function showHistory() {
  historySearch.value = ''
  historyLimit.value = 20
  historyOpen.value = true
  void a.history.load()
}
function selectHistory(id: string) {
  follow = true
  a.selectConversation(id)
  historyOpen.value = false
  void scrollToEnd()
}
function historyDate(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
const messages = ref<HTMLElement | null>(null)
const input = ref<{ focus: () => void } | null>(null)
let follow = true
function onScroll() {
  const el = messages.value
  if (el) follow = el.scrollHeight - el.scrollTop - el.clientHeight < 64
}
async function scrollToEnd() {
  await nextTick()
  if (follow && messages.value) messages.value.scrollTop = messages.value.scrollHeight
}
watch(() => a.turns.map((turn) => [turn.id, turn.status, turn.markdown]), scrollToEnd, { deep: true })
onMounted(scrollToEnd)
async function send() {
  follow = true
  const task = a.ask()
  input.value?.focus()
  await scrollToEnd()
  await task
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault()
    void send()
  }
}
async function newChat() {
  a.reset()
  follow = true
  await nextTick()
  input.value?.focus()
}
</script>

<template>
  <section class="ai-chat flex min-h-0 flex-1 flex-col" aria-label="AI 聊天">
    <header class="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3">
      <UiButton size="sm" variant="text" @click="newChat"><AppIcon name="plus" :size="15" />新对话</UiButton>
      <UiButton size="sm" variant="text" @click="showHistory"><AppIcon name="clock" :size="15" />历史对话</UiButton>
      <UiButton size="sm" variant="text" @click="workspace.openGuide('settings')">AI 设置</UiButton>
    </header>
    <p v-if="a.conversation" class="truncate px-5 pb-2 text-caption text-stone" :title="a.conversation.videoTitle">
      {{ a.conversation.videoTitle }}
    </p>
    <div v-if="a.history.state.error" class="flex items-center gap-2 px-5 pb-2 text-caption text-error" role="alert">
      <span>{{ a.history.state.error }}</span
      ><UiButton size="sm" variant="text" @click="a.history.retry">重试</UiButton>
    </div>
    <div ref="messages" class="scroll-soft min-h-0 flex-1 overflow-y-auto px-5 pb-5" @scroll="onScroll">
      <div v-if="!a.turns.length" class="flex h-full min-h-40 flex-col items-center justify-center gap-3 text-stone">
        <AppIcon name="sparkles" :size="28" />
        <p class="text-body-sm">想聊点什么？</p>
      </div>
      <div v-else role="log" aria-label="聊天消息" aria-live="polite" class="space-y-7 pt-3">
        <article v-for="(turn, index) in a.turns" :key="turn.id" class="space-y-5">
          <div
            class="ml-auto w-fit max-w-[90%] whitespace-pre-wrap rounded-2xl bg-page-cream px-4 py-3 text-body-sm"
            aria-label="你的消息"
          >
            {{ turn.question }}
          </div>
          <div class="min-w-0 space-y-2">
            <p class="text-caption text-stone">AI · {{ turn.model }}</p>
            <PracticeText v-if="turn.markdown" :text="turn.markdown" class="text-body-sm" />
            <p v-if="turn.status === 'pending'" class="text-body-sm text-stone" role="status">正在回复…</p>
            <p v-else-if="turn.status === 'stopped'" class="text-body-sm text-stone">已停止</p>
            <p v-else-if="turn.error" class="text-body-sm text-error" role="alert">{{ turn.error }}</p>
            <UiButton v-if="turn.status === 'done'" size="sm" variant="text" @click="a.copyResult(turn.markdown)"
              >复制</UiButton
            >
            <UiButton
              v-else-if="a.canReply && !a.busy && index === a.turns.length - 1"
              size="sm"
              variant="text"
              @click="a.ask(turn.id)"
              >重试</UiButton
            >
          </div>
        </article>
      </div>
    </div>
    <form v-if="a.canReply" class="shrink-0 p-4 pt-2" @submit.prevent="send">
      <p v-if="a.error" class="mb-2 text-body-sm text-error" role="alert">{{ a.error }}</p>
      <div class="ai-composer rounded-2xl border border-linen p-3 transition-colors focus-within:border-deep-indigo">
        <VTextarea
          ref="input"
          v-model="a.question"
          class="ai-chat-input"
          aria-label="消息"
          placeholder="发送消息…"
          variant="plain"
          bg-color="transparent"
          rows="2"
          max-rows="6"
          auto-grow
          no-resize
          density="compact"
          hide-details
          maxlength="4000"
          @keydown="onKeydown"
        />
        <div class="mt-2 flex items-center gap-3">
          <VSelect
            v-model="a.selectedModel"
            class="min-w-0 flex-1"
            aria-label="模型"
            placeholder="选择模型"
            :items="a.modelOptions"
            :disabled="!a.modelOptions.length"
            variant="plain"
            density="compact"
            hide-details
          />
          <UiButton v-if="a.busy" size="sm" variant="ghost" @click="a.cancel">停止</UiButton>
          <UiButton v-else type="submit" size="sm" variant="dark" :disabled="!a.question.trim() || !a.configured"
            >发送</UiButton
          >
        </div>
      </div>
    </form>
    <div v-else class="shrink-0 p-4 text-right">
      <UiButton variant="dark" size="sm" @click="newChat">新对话</UiButton>
    </div>
    <VDialog v-model="historyOpen" :max-width="600" aria-labelledby="ai-chat-history-title">
      <section class="paper-dialog flex max-h-[75dvh] flex-col bg-pure-white" aria-label="历史对话列表">
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-linen px-6 py-4">
          <h2 id="ai-chat-history-title" class="text-subheading font-bold">历史对话</h2>
          <UiButton icon size="sm" variant="text" title="关闭历史对话" @click="historyOpen = false"
            ><AppIcon name="close" :size="18"
          /></UiButton>
        </header>
        <div class="shrink-0 px-6 pt-4">
          <VTextField
            v-model="historySearch"
            aria-label="搜索对话"
            placeholder="搜索对话"
            hide-details
            density="compact"
          />
        </div>
        <div class="scroll-soft min-h-0 overflow-y-auto px-6 py-4">
          <p v-if="a.history.state.loading" class="py-6 text-center text-body-sm text-stone" role="status">正在读取…</p>
          <div v-else-if="a.history.state.error" class="flex items-center gap-2 text-body-sm text-error" role="alert">
            <span>{{ a.history.state.error }}</span
            ><UiButton size="sm" variant="text" @click="a.history.retry">重试</UiButton>
          </div>
          <ul v-if="filteredHistory.length" class="divide-y divide-linen">
            <li v-for="session in filteredHistory.slice(0, historyLimit)" :key="session.id">
              <button
                type="button"
                class="w-full rounded-lg px-2 py-4 text-left hover:bg-page-cream"
                :aria-label="`打开对话：${session.title}`"
                @click="selectHistory(session.id)"
              >
                <span class="block truncate text-body-sm font-bold">{{ session.title }}</span>
                <span class="mt-1 block truncate text-caption text-stone"
                  >{{ session.courseName }} · {{ session.videoTitle }}</span
                >
                <span class="mt-1 block text-caption text-stone">{{ historyDate(session.updatedAt) }}</span>
              </button>
            </li>
          </ul>
          <p
            v-else-if="!a.history.state.loading && !a.history.state.error"
            class="py-6 text-center text-body-sm text-stone"
          >
            {{ historySearch ? '未找到对话' : '暂无历史对话' }}
          </p>
          <UiButton
            v-if="filteredHistory.length > historyLimit"
            class="mt-3"
            size="sm"
            variant="text"
            @click="historyLimit += 20"
            >加载更多</UiButton
          >
        </div>
      </section>
    </VDialog>
  </section>
</template>

<style scoped>
.ai-chat {
  overflow-wrap: anywhere;
}
.ai-composer :deep(.v-field) {
  padding: 0;
  background: transparent;
}
.ai-composer :deep(.v-field__input) {
  padding: 0;
}
.ai-chat-input :deep(.v-field) {
  --v-field-padding-top: 0px;
  --v-input-padding-top: 0px;
  --v-field-padding-bottom: 0px;
}
.ai-chat-input :deep(textarea.v-field__input) {
  padding: 0;
  line-height: 24px;
  color: var(--color-charcoal-ink);
  caret-color: var(--color-charcoal-ink);
  -webkit-mask-image: none;
  mask-image: none;
}
.ai-chat-input :deep(textarea:focus-visible) {
  outline: none;
}
.ai-composer :deep(.v-select__selection-text) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-composer :deep(.v-select__selection) {
  max-width: 100%;
}
</style>

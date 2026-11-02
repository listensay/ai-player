<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import AiInteractionForm from './AiInteractionForm.vue'
import AiProfileSelector from './AiProfileSelector.vue'
import PracticeText from './PracticeText.vue'
import UiButton from './UiButton.vue'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ generated: []; settings: [] }>()
const guide = useGuide()
const chat = reactive(guide.conversation)
const locked = computed(
  () => chat.state.busy || chat.state.resetting || !!guide.state.busy || !chat.state.ready || !guide.guideReady.value,
)
const resetOpen = ref(false)
async function reset() {
  if (await chat.reset()) resetOpen.value = false
}
const messages = ref<HTMLElement>()
watch(
  () => chat.state.data.turns.map((turn) => [turn.id, turn.status]),
  async () => {
    await nextTick()
    messages.value?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  },
)
async function generate() {
  if (await chat.generatePlan()) emit('generated')
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault()
    void chat.ask()
  }
}
</script>

<template>
  <section aria-label="导学对话" class="guide-conversation">
    <div class="guide-conversation-toolbar">
      <AiProfileSelector compact :disabled="locked" class="guide-profile">
        <template #actions>
          <UiButton
            v-if="chat.state.data.turns.length"
            variant="text"
            size="sm"
            :disabled="locked"
            @click="resetOpen = true"
            >重新定制</UiButton
          >
        </template>
      </AiProfileSelector>
    </div>
    <div v-if="chat.state.storageError" class="flex flex-wrap items-center gap-3" role="alert">
      <p class="text-body-sm text-error">{{ chat.state.storageError }}</p>
      <UiButton size="sm" :disabled="chat.state.loading" @click="chat.state.ready ? chat.save() : chat.load()"
        >重试</UiButton
      >
    </div>
    <p v-if="chat.state.loading" class="text-body-sm text-stone" role="status">正在读取对话…</p>
    <div ref="messages" role="log" aria-label="导学消息" aria-live="polite" class="guide-messages">
      <article v-for="(turn, index) in chat.state.data.turns" :key="turn.id" class="guide-turn">
        <p v-if="turn.kind !== 'initialization'" class="guide-user-message">
          {{ turn.question }}
        </p>
        <div class="guide-ai-message">
          <span class="guide-ai-avatar" aria-hidden="true"><AppIcon name="sparkles" :size="19" /></span>
          <div class="guide-ai-content">
            <p class="guide-speaker">{{ turn.replySource === 'selection' ? '学习安排' : 'AI 导学' }}</p>
            <PracticeText v-if="turn.reply" :text="turn.reply.message" class="text-body" />
            <AiInteractionForm
              v-if="turn.reply?.form"
              :form="turn.reply.form"
              :answers="turn.answers"
              :disabled="locked || index !== chat.state.data.turns.length - 1"
              @submit="chat.submitForm(turn.id, $event)"
            />
            <div v-if="turn.status === 'pending'" class="guide-thinking" role="status">
              <div class="guide-thinking-heading">
                <p>{{ turn.kind === 'initialization' ? '正在生成定制问卷' : '正在整理学习方案' }}</p>
                <UiButton size="sm" variant="text" @click="chat.cancel()">停止</UiButton>
              </div>
              <p v-if="turn.kind === 'initialization'" class="guide-thinking-course">{{ guide.courseName.value }}</p>
              <div class="guide-thinking-track" aria-hidden="true"><span /></div>
            </div>
            <p v-else-if="turn.status === 'stopped'" class="text-body-sm text-stone">已停止</p>
            <p v-else-if="turn.error" class="text-body-sm text-error" role="alert">{{ turn.error }}</p>
            <UiButton
              v-if="['error', 'stopped'].includes(turn.status) && index === chat.state.data.turns.length - 1"
              size="sm"
              :disabled="locked"
              @click="chat.ask(turn.id)"
              >重试</UiButton
            >
            <dl
              v-if="index === chat.state.data.turns.length - 1 && chat.canPlan && chat.arrangement?.length"
              aria-label="已确认的学习安排"
              class="guide-arrangement"
            >
              <div v-for="item in chat.arrangement" :key="item.label">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
            <UiButton
              v-if="index === chat.state.data.turns.length - 1 && chat.canPlan"
              variant="dark"
              :disabled="locked"
              :loading="guide.state.busy === 'plan'"
              @click="generate"
              >{{ guide.state.plan ? '生成调整方案' : '生成学习路线' }}</UiButton
            >
          </div>
        </div>
      </article>
    </div>
    <div v-if="!chat.state.data.turns.length" class="guide-start">
      <div class="guide-start-copy">
        <p class="guide-start-title">从你的课程，开始定制</p>
        <p class="text-body-sm text-graphite">{{ guide.courseName.value }}</p>
      </div>
      <p v-if="chat.state.error" class="text-body-sm text-error" role="alert">{{ chat.state.error }}</p>
      <div class="guide-start-actions">
        <UiButton variant="dark" class="guide-init-button" :disabled="locked" @click="chat.initialize()"
          ><AppIcon name="sparkles" :size="18" />AI 定制初始化<AppIcon name="chevron-right" :size="17"
        /></UiButton>
        <UiButton variant="text" size="sm" @click="emit('settings')">{{
          guide.configured.value ? '管理 AI 配置' : '配置 AI 服务'
        }}</UiButton>
      </div>
    </div>
    <form v-else-if="chat.initialized" class="guide-composer" @submit.prevent="chat.ask()">
      <VTextarea
        v-model="chat.question"
        label="消息"
        placeholder="补充回答，或调整学习方案"
        maxlength="6000"
        rows="3"
        auto-grow
        :disabled="locked"
        @keydown="onKeydown"
      />
      <p v-if="chat.state.error" class="text-body-sm text-error" role="alert">{{ chat.state.error }}</p>
      <div class="flex flex-wrap items-center gap-3">
        <UiButton type="submit" variant="dark" :disabled="locked || !chat.question.trim()">发送</UiButton>
        <UiButton variant="text" size="sm" @click="emit('settings')">{{
          guide.configured.value ? '管理 AI 配置' : '配置 AI 服务'
        }}</UiButton>
      </div>
    </form>
    <VDialog v-model="resetOpen" max-width="400" :persistent="chat.state.resetting">
      <section class="rounded-2xl bg-pure-white p-6" role="dialog" aria-label="重新定制" aria-modal="true">
        <h2 class="text-subheading font-bold">重新定制？</h2>
        <p class="mt-3 text-body-sm">清空这门课程的导学对话。</p>
        <p v-if="chat.state.storageError" class="mt-3 text-body-sm text-error" role="alert">
          {{ chat.state.storageError }}
        </p>
        <div class="mt-6 flex justify-end gap-3">
          <UiButton variant="text" :disabled="chat.state.resetting" @click="resetOpen = false">取消</UiButton>
          <UiButton variant="dark" :loading="chat.state.resetting" @click="reset">重新定制</UiButton>
        </div>
      </section>
    </VDialog>
  </section>
</template>

<style scoped>
.guide-conversation {
  min-width: 0;
  color: var(--color-charcoal-ink);
}
.guide-conversation-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 24px;
  padding: 4px 0 24px;
  border-bottom: 1px solid var(--color-linen);
}
.guide-profile {
  width: 100%;
}
.guide-start {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 28px 0 8px;
}
.guide-start-copy {
  min-width: 0;
}
.guide-start-title {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.4;
}
.guide-start-copy > p {
  overflow-wrap: anywhere;
}
.guide-start-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.guide-init-button.ui-button.v-btn:not(:disabled) {
  background: var(--color-sunbeam-yellow);
  color: var(--color-charcoal-ink);
  box-shadow: none;
}
.guide-messages:not(:empty) {
  padding-top: 28px;
}
.guide-turn + .guide-turn {
  margin-top: 32px;
}
.guide-user-message {
  width: fit-content;
  max-width: 90%;
  margin: 0 0 20px auto;
  padding: 12px 16px;
  border: 1px solid var(--color-linen);
  border-radius: 18px 18px 6px 18px;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.guide-ai-message {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 12px;
}
.guide-ai-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-deep-indigo);
  color: var(--color-pure-white);
}
.guide-ai-content {
  min-width: 0;
}
.guide-ai-content > * + * {
  margin-top: 16px;
}
.guide-arrangement {
  display: grid;
  gap: 12px;
  padding: 20px 0;
  border-top: 1px solid var(--color-linen);
  border-bottom: 1px solid var(--color-linen);
}
.guide-arrangement > div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
  font-size: 14px;
  line-height: 1.7;
}
.guide-arrangement dt {
  color: var(--color-graphite);
}
.guide-arrangement dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--color-charcoal-ink);
  font-weight: 600;
}
.guide-speaker {
  padding-top: 6px;
  font-size: 14px;
  font-weight: 700;
  line-height: 24px;
}
.guide-thinking {
  padding: 8px 0 12px;
}
.guide-thinking-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.guide-thinking-heading > p {
  font-size: 18px;
  line-height: 1.6;
  font-weight: 700;
}
.guide-thinking-course {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-graphite);
  overflow-wrap: anywhere;
}
.guide-thinking-track {
  position: relative;
  height: 4px;
  margin-top: 20px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--color-linen);
}
.guide-thinking-track span {
  display: block;
  width: 30%;
  height: 100%;
  border-radius: inherit;
  background: var(--color-sunbeam-yellow);
  animation: guide-thinking 1.8s var(--ease-soft) infinite;
}
@keyframes guide-thinking {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(340%);
  }
}
.guide-composer {
  display: grid;
  gap: 16px;
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid var(--color-linen);
}
@media (max-width: 640px) {
  .guide-profile {
    flex-basis: 100%;
    width: 100%;
  }
  .guide-ai-message {
    grid-template-columns: minmax(0, 1fr);
  }
  .guide-ai-avatar {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .guide-thinking-track span {
    animation: none;
    width: 40%;
  }
}
</style>

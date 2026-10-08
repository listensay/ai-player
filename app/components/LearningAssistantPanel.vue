<script setup lang="ts">
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue'
import { useCourseWorkspace } from '~/composables/useCourseWorkspace'
import type { AssistantMode } from '~/types/learningAssistant'
import { formatTime } from '~/utils/time'
import { programmingQuestion } from '~/utils/programming'
import UiButton from './UiButton.vue'
import PracticeText from './PracticeText.vue'
import LearningMapTree from './LearningMapTree.vue'
const LearningCodeScratch = defineAsyncComponent(() => import('./LearningCodeScratch.vue'))
const workspace = useCourseWorkspace(),
  a = reactive(workspace.assistant)
const modes: Array<{ id: AssistantMode; label: string }> = [
  { id: 'ask', label: '随堂问答' },
  { id: 'notes', label: '笔记 AI' },
  { id: 'map', label: '知识脑图' },
  { id: 'cards', label: '记忆闪卡' },
  { id: 'feynman', label: '费曼对练' },
  { id: 'vision', label: '画面识别' },
  { id: 'highlights', label: '精华跳读' },
]
const presets = [
  '用大白话和生活比喻解释这里的概念',
  '这里的底层原理是什么？',
  '这行代码为什么要这么写？如果字幕没有代码，请明确说明',
]
const flipped = ref<number | null>(null),
  scratchOpen = ref(false),
  importConfirmed = ref(false)
let importBaseline: { id: string; draft: string } | null = null
watch(
  importConfirmed,
  (confirmed) => {
    const record = workspace.practice.current.value
    importBaseline = confirmed && record ? { id: record.id, draft: record.draft } : null
  },
  { flush: 'sync' },
)
const activeExercise = computed(() =>
  workspace.practice.current.value?.path === workspace.video.value?.path
    ? programmingQuestion(workspace.practice.current.value?.question)
    : null,
)
watch(
  () => a.extraction,
  () => {
    scratchOpen.value = false
    importConfirmed.value = false
  },
)
watch(
  () => a.cards,
  () => {
    flipped.value = null
  },
)
function importCode() {
  if (!importConfirmed.value || !a.extraction?.code || !activeExercise.value || workspace.practice.state.busy) return
  const record = workspace.practice.current.value
  if (!record || !importBaseline || record.id !== importBaseline.id || record.draft !== importBaseline.draft) {
    importConfirmed.value = false
    a.error = '目标练习或草稿已变化，请重新确认后再导入。'
    return
  }
  workspace.practice.updateDraft(a.extraction.code)
  workspace.practice.state.open = true
  importConfirmed.value = false
}
function seek(seconds: number) {
  a.skipTransitions = false
  workspace.seekTo(seconds)
}
function saveCode(code: string, language: string) {
  void a.insertNote(`\`\`\`${language}\n${code}\n\`\`\``, a.imageSeconds)
}
</script>
<template>
  <section class="assistant-panel scroll-soft min-h-0 flex-1 overflow-y-auto p-4" aria-label="AI 随堂助教">
    <div class="assistant-toolbar">
      <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-bold">Playbo 随堂助教</h2>
        <UiButton variant="text" size="sm" @click="workspace.openGuide('settings')">AI 设置</UiButton>
      </header>
      <nav class="mb-4 flex flex-wrap gap-1.5" aria-label="学习工具">
        <button
          v-for="item in modes"
          :key="item.id"
          type="button"
          class="tool-tab"
          :aria-pressed="a.mode === item.id"
          :disabled="!!a.busy"
          @click="a.open(item.id)"
        >
          {{ item.label }}
        </button>
      </nav>
    </div>
    <p class="mb-3 text-caption text-stone">
      生成预览仅保留在本课会话中，切课后清空。请将需要保留的内容加入笔记或复习队列。
    </p>
    <details v-if="a.contextPreview" class="material-preview mb-4 rounded-xl border border-linen p-3">
      <summary class="cursor-pointer text-caption font-medium">
        本次课程材料 · {{ a.contextPreview.evidence.length }} 条来源 · {{ formatTime(a.contextPreview.start) }}–{{
          formatTime(a.contextPreview.end)
        }}
      </summary>
      <p v-if="a.contextPreview.truncated" class="mt-2 text-caption text-error">
        材料较长，仅处理以下部分内容，不代表完整课程。
      </p>
      <div class="scroll-soft mt-2 max-h-48 space-y-3 overflow-auto text-caption">
        <p v-for="source in a.contextPreview.evidence" :key="source.id">
          <button class="source-link" type="button" @click="seek(source.start)">{{ formatTime(source.start) }}</button>
          {{ source.id === 'n:note' ? '【用户笔记，时间为关联位置】' : '' }}{{ source.text }}
        </p>
        <p v-if="a.contextPreview.note" class="whitespace-pre-wrap">附带笔记：{{ a.contextPreview.note }}</p>
        <p v-if="!a.contextPreview.evidence.length">当前没有字幕或知识点；请先转写字幕或在笔记 AI 中提供文字。</p>
      </div>
    </details>
    <label v-if="!['notes', 'vision', 'highlights'].includes(a.mode)" class="mb-4 flex items-center gap-2 text-caption"
      ><input
        v-model="a.includeNote"
        type="checkbox"
        :disabled="!!a.busy"
      />同时发送当前已加载的笔记（含未保存内容）</label
    >
    <div
      v-if="a.busy"
      role="status"
      class="mb-3 flex items-center justify-between gap-2 rounded-xl bg-sunbeam-yellow/15 p-3 text-body-sm"
    >
      {{ a.busy }}…
      <UiButton v-if="a.busy !== '正在加入复习队列'" size="sm" variant="text" @click="a.cancel">取消</UiButton>
    </div>
    <p v-if="a.error" role="alert" class="mb-3 text-body-sm text-error">{{ a.error }}</p>
    <p v-if="a.notice" role="status" class="mb-3 text-caption text-stone">{{ a.notice }}</p>

    <div v-if="a.mode === 'ask'" class="space-y-4">
      <div class="flex items-center justify-between gap-2 text-caption">
        <span>提问定位 {{ formatTime(a.anchor) }} · 前后各 90 秒</span
        ><UiButton variant="text" size="sm" :disabled="!!a.busy" @click="a.refreshAnchor">使用当前播放位置</UiButton>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="preset in presets"
          :key="preset"
          class="preset"
          type="button"
          :disabled="!!a.busy"
          @click="a.ask(preset)"
        >
          {{ preset }}
        </button>
      </div>
      <article v-for="(turn, index) in a.turns" :key="index" class="space-y-3 rounded-2xl border border-linen p-3">
        <h3 class="text-body-sm font-bold">{{ turn.question }}</h3>
        <PracticeText :text="turn.markdown" />
        <div class="flex flex-wrap gap-2">
          <button
            v-for="source in turn.sources"
            :key="source.id"
            type="button"
            class="source-link"
            @click="seek(source.start)"
          >
            来源 {{ formatTime(source.start) }}
          </button>
        </div>
        <UiButton
          size="sm"
          variant="ghost"
          @click="a.insertNote(`### ${turn.question}\n\n${turn.markdown}`, turn.seconds)"
          >插入 {{ formatTime(turn.seconds) }} 笔记</UiButton
        >
      </article>
      <form class="space-y-2" @submit.prevent="a.ask()">
        <label for="assistant-question" class="text-body-sm font-medium">哪里还没理解？</label
        ><textarea
          id="assistant-question"
          v-model="a.question"
          rows="3"
          maxlength="4000"
          placeholder="输入问题，AI 会带上这一刻的课程上下文"
          :disabled="!!a.busy"
        /><UiButton type="submit" :disabled="!!a.busy || !a.question.trim()">询问助教</UiButton>
      </form>
    </div>

    <div v-else-if="a.mode === 'notes'" class="space-y-3">
      <p class="text-caption text-stone">
        在笔记中选中文字后点击“AI 整理”，或粘贴文字。留空则整理当前字幕。生成不会自动改写笔记。
      </p>
      <label class="block text-body-sm" for="assistant-note">待整理文字</label
      ><textarea id="assistant-note" v-model="a.noteInput" rows="5" maxlength="12000" :disabled="!!a.busy" />
      <div class="flex flex-wrap gap-2">
        <UiButton
          v-for="action in ['精炼为技术卡片', '对比表格', '补充边界条件', '补全注释与示例']"
          :key="action"
          size="sm"
          variant="ghost"
          :disabled="!!a.busy"
          @click="a.improveNote(action)"
          >{{ action }}</UiButton
        >
      </div>
      <article v-if="a.noteResult" class="space-y-3 rounded-xl border border-linen p-3">
        <PracticeText :text="a.noteResult.markdown" />
        <div class="flex flex-wrap gap-2">
          <UiButton size="sm" @click="a.saveNoteResult(false)">追加到笔记</UiButton
          ><UiButton v-if="a.selection" size="sm" variant="ghost" @click="a.saveNoteResult(true)"
            >确认替换原选区</UiButton
          >
        </div>
        <p class="text-caption text-stone">可在编辑器撤销；若原笔记已变化，将拒绝替换。</p>
      </article>
    </div>

    <div v-else-if="a.mode === 'map'" class="space-y-3">
      <UiButton :disabled="!!a.busy" @click="a.generateMap">{{
        a.graph.length ? '重新生成脑图' : '生成知识脑图'
      }}</UiButton>
      <p class="text-caption text-stone">点击概念折叠／展开，点击时间戳回到对应讲解。</p>
      <LearningMapTree v-if="a.graph.length" :nodes="a.graph" @seek="seek" />
      <details v-if="a.graph.length">
        <summary class="text-caption">Mermaid 源码</summary>
        <pre class="scroll-soft mt-2 overflow-auto rounded-xl bg-cream-deep p-3 text-caption">{{ a.mermaid }}</pre>
        <UiButton size="sm" variant="ghost" class="mt-2" @click="a.insertNote('```mermaid\n' + a.mermaid + '\n```')"
          >脑图源码加入笔记</UiButton
        >
      </details>
    </div>

    <div v-else-if="a.mode === 'cards'" class="space-y-3">
      <UiButton :disabled="!!a.busy" @click="a.generateCards">生成 3–5 张记忆卡片</UiButton>
      <article v-for="(card, index) in a.cards" :key="index" class="space-y-3 rounded-2xl border border-linen p-4">
        <button
          class="w-full text-left font-bold"
          type="button"
          :aria-expanded="flipped === index"
          @click="flipped = flipped === index ? null : index"
        >
          {{ index + 1 }}. {{ card.front
          }}<span class="mt-2 block text-caption text-stone">{{
            flipped === index ? '收起答案' : '想一想，再点击翻面'
          }}</span></button
        ><PracticeText v-if="flipped === index" :text="card.back" />
        <details>
          <summary class="text-caption">编辑卡片</summary>
          <label class="mt-2 block text-caption"
            >正面<textarea v-model="card.front" rows="2" maxlength="500" :disabled="!!a.busy" /></label
          ><label class="mt-2 block text-caption"
            >背面<textarea v-model="card.back" rows="4" maxlength="3000" :disabled="!!a.busy" />
          </label>
        </details>
        <button
          v-for="source in card.sources"
          :key="source.id"
          class="source-link mr-2"
          type="button"
          @click="seek(source.start)"
        >
          回看 {{ formatTime(source.start) }}
        </button>
      </article>
      <UiButton v-if="a.cards.length" :disabled="!!a.busy" @click="a.addCards">确认加入抗遗忘复习队列</UiButton>
    </div>

    <div v-else-if="a.mode === 'feynman'" class="space-y-3">
      <VSelect
        v-model="a.feynman.role"
        label="对练角色"
        :disabled="!!a.busy"
        :items="[
          { title: '小白新手', value: 'novice' },
          { title: '技术面试官', value: 'interviewer' },
        ]"
        hide-details
        density="compact"
      />
      <UiButton :disabled="!!a.busy" @click="a.startFeynman">{{
        a.feynman.question ? '重新开始对练' : '开始对练'
      }}</UiButton
      ><template v-if="a.feynman.question"
        ><PracticeText :text="a.feynman.question.question" /><label for="feynman-answer" class="block text-caption"
          >用自己的话讲清楚</label
        ><textarea
          id="feynman-answer"
          v-model="a.feynman.answer"
          maxlength="8000"
          rows="6"
          :disabled="!!a.busy || !!a.feynman.feedback"
        /><UiButton :disabled="!!a.busy || !a.feynman.answer.trim() || !!a.feynman.feedback" @click="a.evaluateFeynman"
          >提交解释</UiButton
        ></template
      >
      <article v-if="a.feynman.feedback" class="space-y-3 rounded-xl border border-linen p-3">
        <p class="font-bold">本轮理解度参考：{{ a.feynman.feedback.score }}/100</p>
        <p class="text-caption text-stone">AI 评分仅为练习参考，不会自动修改知识掌握度。</p>
        <PracticeText :text="a.feynman.feedback.markdown" />
        <ul class="list-disc pl-5 text-body-sm">
          <li v-for="gap in a.feynman.feedback.gaps" :key="gap">{{ gap }}</li>
        </ul>
        <button
          v-for="source in a.feynman.feedback.sources"
          :key="source.id"
          type="button"
          class="source-link mr-2"
          @click="seek(source.start)"
        >
          回看 {{ formatTime(source.start) }}
        </button>
        <div class="flex flex-wrap gap-2">
          <UiButton size="sm" @click="a.followUp">继续追问</UiButton
          ><UiButton
            size="sm"
            variant="ghost"
            @click="
              a.insertNote(
                '### 费曼对练\n\n' +
                  a.feynman.question?.question +
                  '\n\n我的解释：\n' +
                  a.feynman.answer +
                  '\n\n反馈：\n' +
                  a.feynman.feedback.markdown,
              )
            "
            >保存本轮复盘</UiButton
          >
        </div>
      </article>
      <p v-if="a.feynman.rounds.length" class="text-caption text-stone">
        本次已完成 {{ a.feynman.rounds.length }} 轮对练。
      </p>
    </div>

    <div v-else-if="a.mode === 'vision'" class="space-y-3">
      <p class="text-caption text-stone">
        普通截图仍只存本地。本工具仅在你确认后上传这一张画面；请先检查是否含敏感信息。
      </p>
      <UiButton :disabled="!!a.busy || !workspace.player.state.frameReady" @click="a.capture"
        >截取当前画面（仅本地预览）</UiButton
      ><template v-if="a.imageUrl"
        ><img
          :src="a.imageUrl"
          :alt="`待识别画面 ${formatTime(a.imageSeconds)}`"
          class="w-full rounded-xl border border-linen"
        />
        <p class="break-all text-caption text-stone">
          发送至：{{ workspace.guide.state.settings.baseUrl }} · {{ workspace.guide.state.settings.model }}
        </p>
        <label class="flex items-start gap-2 text-caption"
          ><input
            v-model="a.imageConsent"
            type="checkbox"
            :disabled="!!a.busy"
          />我确认将这张截图和预览中的课程上下文发送至上述 AI 服务（需要支持视觉的模型）。</label
        >
        <div class="flex gap-2">
          <UiButton :disabled="!!a.busy || !a.imageConsent" @click="a.extract">识别代码／公式</UiButton
          ><UiButton variant="ghost" :disabled="!!a.busy" @click="a.clearFrame">丢弃截图</UiButton>
        </div></template
      >
      <article v-if="a.extraction" class="space-y-3">
        <PracticeText :text="a.extraction.markdown" />
        <p v-if="a.extraction.warnings" role="status" class="text-body-sm text-error">
          识别提醒：{{ a.extraction.warnings }}
        </p>
        <UiButton size="sm" @click="a.insertNote(a.extraction.markdown, a.imageSeconds)">识别结果加入笔记</UiButton
        ><UiButton v-if="a.extraction.code && !scratchOpen" size="sm" variant="ghost" @click="scratchOpen = true"
          >将代码载入独立 Monaco 练习台</UiButton
        ><LearningCodeScratch
          v-if="scratchOpen && a.extraction.code"
          :code="a.extraction.code"
          :language="a.extraction.language"
          @save="saveCode"
        />
        <div v-if="activeExercise && a.extraction.code" class="space-y-2 rounded-xl border border-linen p-3">
          <label class="flex gap-2 text-caption"
            ><input
              v-model="importConfirmed"
              type="checkbox"
            />确认用识别代码替换当前编程练习草稿（不会自动运行）</label
          ><UiButton
            size="sm"
            variant="ghost"
            :disabled="!importConfirmed || !!workspace.practice.state.busy"
            @click="importCode"
            >填入当前练习</UiButton
          >
        </div>
      </article>
    </div>

    <div v-else-if="a.mode === 'highlights'" class="space-y-3">
      <p class="text-caption text-stone">
        AI 标记可能误判，请先核对。未知区域与演示练习不会跳过；跳过的播放位移不算实际学习用时。
      </p>
      <UiButton :disabled="!!a.busy" @click="a.analyzeHighlights">分析字幕并标记片段</UiButton
      ><label v-if="a.highlights.length" class="flex items-center gap-2 text-body-sm"
        ><input
          v-model="a.skipTransitions"
          type="checkbox"
          :disabled="!!a.busy"
        />开启精华跳读：仅自动跳过“过渡／闲聊”</label
      ><UiButton v-if="a.lastSkip !== null" size="sm" variant="ghost" @click="a.undoSkip"
        >撤销上次跳过并关闭跳读</UiButton
      >
      <article
        v-for="(segment, index) in a.highlights"
        :key="index"
        class="space-y-2 rounded-xl border border-linen p-3"
      >
        <button class="source-link" type="button" @click="seek(segment.start)">
          {{ formatTime(segment.start) }}–{{ formatTime(segment.end) }}
        </button>
        <VSelect
          v-model="segment.kind"
          label="片段分类"
          :disabled="a.skipTransitions"
          :items="[
            { title: '核心讲解', value: 'core' },
            { title: '演示练习', value: 'practice' },
            { title: '过渡／闲聊', value: 'transition' },
          ]"
          hide-details
          density="compact"
        />
        <p class="text-caption text-stone">{{ segment.reason }}</p>
      </article>
    </div>
  </section>
</template>
<style scoped>
.assistant-toolbar {
  position: sticky;
  top: -16px;
  z-index: 2;
  margin: -16px -16px 12px;
  padding: 16px 16px 0;
  border-bottom: 1px solid #e2ded9;
  background: #fff;
}
.assistant-panel {
  overflow-wrap: anywhere;
}
.assistant-panel textarea {
  display: block;
  width: 100%;
  resize: vertical;
  border: 1px solid #e2ded9;
  border-radius: 12px;
  padding: 10px 12px;
  background: #fff;
  font-size: 14px;
}
.assistant-panel textarea:focus {
  outline: 2px solid #5144a3;
  outline-offset: 2px;
}
.tool-tab {
  border: 1px solid #e2ded9;
  border-radius: 999px;
  padding: 7px 11px;
  font-size: 12px;
}
.tool-tab[aria-pressed='true'] {
  background: #ffce00;
  border-color: #ffce00;
  font-weight: 700;
}
.preset {
  border: 1px solid #e2ded9;
  border-radius: 12px;
  padding: 8px 10px;
  font-size: 12px;
  text-align: left;
}
.source-link {
  color: #5144a3;
  text-decoration: underline;
  font-size: 12px;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

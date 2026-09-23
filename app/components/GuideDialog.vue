<script setup lang="ts">
import type { VideoEntry } from '~/types/course'
import type { DependencyRisk, GuideSettings, LessonStatus, TodayItem } from '~/types/guide'
import { formatStudyDuration, LESSON_STATUS_LABELS } from '~/utils/guide'

const props = defineProps<{ open: boolean; currentVideo: VideoEntry | null; initialQuestion?: string; initialTab?: 'plan' | 'today' | 'help' | 'settings' }>()
const emit = defineEmits<{ close: []; select: [path: string, seconds?: number, returning?: boolean, questionId?: string]; segment: [item: TodayItem] }>()
const guide = useGuide()
const { state, schedule, counts, risks } = guide
const dialog = ref<HTMLDialogElement>()
const tab = ref<'plan' | 'map' | 'help' | 'settings' | 'today'>('plan')
const draft = ref('')
const dailyMinutes = ref(120)
const question = ref('')
const editingQuestionId = ref('')
const questionSource = ref({ path: '', seconds: 0 })
const player = usePlayer()
const questionForm = ref<HTMLElement>()
const settings = reactive<GuideSettings>({ baseUrl: '', model: '', apiKey: '', timeoutMinutes: 15 })
const settingsMessage = ref('')
const settingsError = ref('')
const pending = ref<{ path: string; status: LessonStatus; risks: DependencyRisk[] } | null>(null)
const pendingAlert = ref<HTMLElement>()
const lessonQuery = ref('')
const tabs = [{ id: 'today', label: '今日学习与打卡' }, { id: 'plan', label: '定制路线' }, { id: 'map', label: '知识地图' }, { id: 'help', label: '卡点回溯' }, { id: 'settings', label: 'AI 设置' }] as const
const examples = [
  '我学过 Java 基础，想快速上手 SpringBoot 开发项目，每天有 2 小时。',
  '我是零基础，想循序渐进学完这门课，每天有 1 小时。',
  '我有相关经验，想查漏补缺，重点学习项目实战，每天 30 分钟。',
]
const visibleLessons = computed(() => state.plan?.lessons.filter(l => {
  const q = lessonQuery.value.trim().toLowerCase()
  return !q || `${l.path} ${l.concepts.join(' ')}`.toLowerCase().includes(q)
}) ?? [])
const moduleMap = computed(() => new Map(state.plan?.modules.map(m => [m.id, m]) ?? []))
const first = computed(() => guide.firstLesson.value)

function title(path: string) { return guide.videoMap.value.get(path)?.title ?? path }
function moduleLessons(id: string) { return state.plan?.lessons.filter(l => l.moduleId === id) ?? [] }
function moduleDependencies(id: string) {
  return [...new Set(moduleLessons(id).flatMap(l => l.prerequisites.map(p => guide.lessonMap.value.get(p)?.moduleId)))]
    .filter((key): key is string => !!key && key !== id).map(key => moduleMap.value.get(key)?.title ?? key)
}

watch(() => props.open, async open => {
  if (open) {
    tab.value = props.initialTab ?? 'plan'
    dailyMinutes.value = state.plan?.dailyMinutes ?? 120
    Object.assign(settings, state.settings)
    if (props.initialQuestion !== undefined) {
      question.value = props.initialQuestion; tab.value = 'help'
      editingQuestionId.value = guide.activeQuestion.value?.id ?? ''
    }
    const entry = state.questions.find(q => q.id === editingQuestionId.value)
    questionSource.value = entry ? { path: entry.path, seconds: entry.seconds }
      : { path: props.currentVideo?.path ?? '', seconds: player.state.currentTime }
    await nextTick()
    if (!dialog.value?.open) dialog.value?.showModal()
  } else dialog.value?.close()
})
watch(() => props.initialQuestion, value => { if (value !== undefined) { question.value = value; tab.value = 'help' } })
watch(() => state.plan, () => { pending.value = null; dailyMinutes.value = state.plan?.dailyMinutes ?? dailyMinutes.value })
watch(pending, async value => { if (value) { await nextTick(); pendingAlert.value?.scrollIntoView({ block: 'nearest' }) } })
onMounted(() => { if (props.open) dialog.value?.showModal() })

async function generate() {
  if (!guide.configured.value) { tab.value = 'settings'; settingsError.value = '先连接一个 AI 服务，再生成路线。'; return }
  if (await guide.generate(draft.value, Number(dailyMinutes.value))) { draft.value = ''; pending.value = null }
}
function updateDailyMinutes() {
  if (state.plan && !guide.setDailyMinutes(Number(dailyMinutes.value))) dailyMinutes.value = state.plan.dailyMinutes
}
function start() {
  if (!first.value) return
  state.view = 'route'
  emit('select', first.value.path)
  emit('close')
}
function requestStatus(path: string, event: Event) {
  const select = event.target as HTMLSelectElement
  const status = select.value as LessonStatus
  const original = guide.lessonMap.value.get(path)?.status ?? 'optional'
  select.value = original
  if (original === status) return
  const proposed = guide.previewStatus(path, status)
  const added = proposed.filter(r => !risks.value.some(existing => existing.prerequisite === r.prerequisite))
  if (added.length) pending.value = { path, status, risks: added }
  else { guide.setStatus(path, status); pending.value = null }
}
function confirmStatus() {
  if (pending.value) guide.setStatus(pending.value.path, pending.value.status)
  pending.value = null
}
function saveSettings() {
  settingsError.value = ''; settingsMessage.value = ''
  try {
    const timeout = Math.min(Math.max(Number(settings.timeoutMinutes) || 15, 1), 30)
    settings.timeoutMinutes = timeout
    guide.saveSettings({ ...settings })
    settingsMessage.value = '设置已保存，可以开始定制路线。'
  }
  catch (err) { settingsError.value = (err as Error).message }
}
async function findFallback() {
  const entry = saveQuestionDraft()
  if (!entry) return
  if (!guide.configured.value) { tab.value = 'settings'; settingsError.value = '先连接 AI 服务，再查找基础课。'; return }
  const video = guide.videoMap.value.get(entry.path)
  if (video) await guide.findFallback(question.value, video, entry.seconds, entry.id)
}
function saveQuestionDraft() {
  const entry = guide.saveQuestion(question.value, questionSource.value.path, questionSource.value.seconds, editingQuestionId.value)
  if (!entry) { state.error = '先填写疑问，并选择对应课节。'; return }
  editingQuestionId.value = entry.id
  guide.selectQuestion(entry.id)
  return entry
}
async function loadQuestion(id: string) {
  guide.selectQuestion(id)
  const entry = guide.activeQuestion.value
  if (!entry) return
  editingQuestionId.value = entry.id; question.value = entry.text
  questionSource.value = { path: entry.path, seconds: entry.seconds }
  tab.value = 'help'
  await nextTick(); questionForm.value?.scrollIntoView({ block: 'start' })
}
function newQuestion() {
  editingQuestionId.value = ''; question.value = ''; state.activeQuestionId = ''
  state.recommendations = []; state.fallbackMessage = ''
  questionSource.value = { path: props.currentVideo?.path ?? '', seconds: player.state.currentTime }
}
function jumpBack(path: string, seconds?: number) {
  if (editingQuestionId.value) guide.markQuestionReview(editingQuestionId.value, path)
  emit('select', path, seconds ?? 0, true, editingQuestionId.value); emit('close')
}
</script>

<template>
  <dialog ref="dialog" aria-labelledby="guide-title"
    class="m-auto h-[min(90dvh,900px)] w-[min(96vw,1120px)] max-w-none overflow-hidden rounded-3xl border border-linen bg-page-cream p-0 text-charcoal-ink shadow-float backdrop:bg-charcoal-ink/40"
    @cancel.prevent="emit('close')" @close="emit('close')" @click="($event.target === dialog) && emit('close')">
    <div class="flex h-full flex-col">
      <header class="flex shrink-0 items-center justify-between gap-3 border-b border-linen bg-pure-white px-5 py-4 sm:px-7">
        <div class="flex items-center gap-3">
          <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-sunbeam-yellow"><AppIcon name="sparkles" :size="24" /></span>
          <div><h2 id="guide-title" class="text-subheading">AI 智能导学</h2><p class="text-caption text-stone">少一点绕路，多一点学会。</p></div>
        </div>
        <UiButton variant="text" size="sm" icon title="关闭导学" @click="emit('close')"><AppIcon name="close" :size="20" /></UiButton>
      </header>
      <nav class="flex shrink-0 gap-1 overflow-x-auto border-b border-linen bg-pure-white px-4 py-2" aria-label="导学功能">
        <button v-for="item in tabs" :key="item.id" type="button" :aria-current="tab === item.id ? 'page' : undefined"
          class="shrink-0 rounded-full px-4 py-2 text-body-sm font-bold transition-colors"
          :class="tab === item.id ? 'bg-charcoal-ink text-pure-white' : 'text-stone hover:bg-page-cream'" @click="tab = item.id">{{ item.label }}</button>
      </nav>

      <div v-if="state.error || state.storageError" role="alert" class="flex shrink-0 items-start gap-3 border-b border-error/20 bg-pure-white px-6 py-3 text-body-sm text-error">
        <p class="flex-1">{{ state.error || state.storageError }}</p>
        <button type="button" class="shrink-0 underline" @click="state.error = ''; state.storageError = ''">知道了</button>
      </div>
      <div v-if="state.busy" role="status" class="flex shrink-0 items-center justify-between gap-3 border-b border-linen bg-sunbeam-yellow/15 px-6 py-3 text-body-sm">
        <span>{{ state.busy === 'plan' ? '正在梳理知识依赖并定制路线…' : '正在为疑问匹配基础课与字幕片段…' }}</span>
        <button type="button" class="shrink-0 font-bold underline" @click="guide.cancel()">取消</button>
      </div>

      <div class="scroll-soft min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <TodayPlanPanel v-show="tab === 'today'" @segment="item => { emit('segment', item); emit('close') }" @question="loadQuestion" @plan="tab = 'plan'" />
        <div v-show="tab === 'plan'" class="grid items-start gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
          <section class="pane p-5">
            <span class="text-caption font-bold text-stone">{{ state.plan ? '让路线跟着你调整' : '01 / 先认识一下你' }}</span>
            <h3 class="mt-2 text-heading-sm">这次，你想学会什么？</h3>
            <p class="mt-2 text-body-sm leading-relaxed text-graphite">说说你的基础和目标，AI 会帮你留下值得看的课，也守住必要的前置知识。</p>
            <form class="mt-4 space-y-4" @submit.prevent="generate">
              <label class="block text-body-sm font-bold">{{ state.plan ? '继续补充或调整目标' : '学习背景与目标' }}
                <textarea v-model="draft" required maxlength="6000" rows="5" :disabled="!!state.busy"
                  class="guide-input mt-2 resize-y font-normal" placeholder="例如：我学过 Java 基础，想快速学会 SpringBoot 项目开发…" />
              </label>
              <div v-if="!state.plan" class="flex flex-col items-start gap-2">
                <button v-for="(example, index) in examples" :key="example" type="button" :disabled="!!state.busy"
                  class="rounded-full border border-linen px-3 py-1.5 text-caption text-graphite hover:bg-page-cream" @click="draft = example">{{ ['有基础，直奔项目', '零基础，循序渐进', '有经验，查漏补缺'][index] }}</button>
              </div>
              <label class="flex items-center justify-between gap-3 text-body-sm">每天可投入
                <span class="flex items-center gap-2"><input v-model.number="dailyMinutes" aria-label="每天学习分钟数" type="number" min="5" max="1440" step="1" required :disabled="!!state.busy" class="guide-input text-center" style="width: 5rem" @change="updateDailyMinutes" />分钟</span>
              </label>
              <p v-if="state.plan" class="text-caption text-stone">修改每日时间，排期会直接更新。</p>
              <UiButton type="submit" variant="primary" class="w-full" :disabled="!!state.busy"><AppIcon name="sparkles" :size="18" />{{ state.plan ? '调整我的路线' : '生成我的路线' }}</UiButton>
            </form>
            <p class="mt-3 text-caption leading-relaxed text-stone">根据课程标题与时长规划，不上传视频。{{ state.scanning ? `正在读取时长 ${state.scanned}/${guide.videoMap.value.size}，可先生成路线。` : '路线与学情画像保存在当前浏览器。' }}</p>
            <button v-if="!guide.configured.value" type="button" class="mt-3 text-body-sm font-bold underline" @click="tab = 'settings'">连接 AI 服务 →</button>
            <template v-if="state.plan">
              <div class="mt-5 border-t border-linen pt-4"><h4 class="text-caption font-bold text-stone">当前学情画像</h4><p class="mt-2 whitespace-pre-wrap break-words text-body-sm leading-relaxed">{{ state.plan.profile }}</p></div>
              <details v-if="state.plan.messages.length" class="mt-4 text-body-sm">
                <summary class="cursor-pointer font-bold text-graphite">查看导学对话</summary>
                <div class="mt-3 max-h-72 space-y-3 overflow-y-auto">
                  <div v-for="(message, index) in state.plan.messages" :key="index" class="rounded-xl p-3" :class="message.role === 'user' ? 'bg-page-cream' : 'bg-deep-indigo/5'">
                    <p class="mb-1 text-caption font-bold text-stone">{{ message.role === 'user' ? '你' : 'AI 导学' }}</p><p class="whitespace-pre-wrap break-words leading-relaxed">{{ message.content }}</p>
                  </div>
                </div>
              </details>
            </template>
          </section>

          <div v-if="!state.plan" class="pane px-6 py-10 sm:p-10">
            <div class="mb-7 flex h-20 w-20 items-center justify-center rounded-full bg-sunbeam-yellow/30 text-deep-indigo"><AppIcon name="route" :size="40" /></div>
            <p class="text-caption font-bold text-stone">你的下一步，可以更清楚</p>
            <h3 class="mt-3 text-heading">把一整套教程，<br />变成适合你的路。</h3>
            <p class="mt-4 max-w-md text-body-sm leading-7 text-graphite">已准备好 {{ guide.videoMap.value.size }} 节课程。告诉我你从哪里出发，我们一起决定先学什么、哪些可以略过、哪里值得多停一会儿。</p>
            <ol class="mt-8 space-y-5">
              <li v-for="(item, i) in ['看清知识板块和前置依赖', '保留必修，按需查漏', '按每天的空闲时间安排节奏']" :key="item" class="flex items-center gap-3 text-body-sm"><span class="flex h-7 w-7 items-center justify-center rounded-full bg-page-cream text-caption font-bold">{{ i + 1 }}</span>{{ item }}</li>
            </ol>
            <p v-if="state.notice" role="status" class="mt-6 text-body-sm text-stone">{{ state.notice }}</p>
          </div>
          <div v-else class="min-w-0 space-y-5">
            <section class="pane p-5">
              <div class="flex flex-wrap items-center justify-between gap-3"><h3 class="text-subheading">你的学习路线</h3><button type="button" class="text-caption font-bold text-stone underline" @click="guide.exportPlan()">导出路线</button></div>
              <p class="mt-3 whitespace-pre-wrap break-words text-body-sm leading-relaxed text-graphite">{{ state.plan.summary }}</p>
              <div class="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-page-cream p-4 text-center">
                <div><p class="text-heading-sm">{{ counts.required }}<span class="ml-1 text-caption font-medium">节</span></p><p class="text-caption text-stone">必修</p></div>
                <div><p class="text-heading-sm">{{ counts.optional }}<span class="ml-1 text-caption font-medium">节</span></p><p class="text-caption text-stone">选修 / 查漏</p></div>
                <div><p class="text-heading-sm">{{ counts.skipped }}<span class="ml-1 text-caption font-medium">节</span></p><p class="text-caption text-stone">已跳过</p></div>
              </div>
              <p v-if="state.notice" role="status" class="mt-3 text-caption leading-relaxed text-stone">{{ state.notice }}</p>
              <div v-if="risks.length" role="alert" class="mt-4 rounded-xl border border-brand-orange/30 bg-brand-orange/8 p-4">
                <h4 class="text-body-sm font-bold">有 {{ risks.length }} 节前置知识尚未加入路线</h4>
                <p v-for="risk in risks" :key="risk.prerequisite" class="mt-2 text-caption leading-relaxed">「{{ title(risk.prerequisite) }}」是「{{ risk.dependents.map(title).join('、') }}」的前置课。</p>
                <UiButton class="mt-3" size="sm" :disabled="!!state.busy" @click="guide.repairDependencies()">补齐前置课</UiButton>
              </div>
              <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
                <label class="flex items-center gap-2 text-body-sm"><input v-model="state.includeOptional" type="checkbox" :disabled="!!state.busy" class="accent-charcoal-ink" />路线包含选修课</label>
                <UiButton variant="dark" size="sm" :disabled="!first || !!state.busy" @click="start"><AppIcon name="play" :size="16" />{{ schedule.completed === guide.route.value.length ? '再学一遍' : schedule.completed ? '继续学习' : '一键开始首课' }}</UiButton>
              </div>
            </section>

            <section class="pane p-5" aria-label="学习排期">
              <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="text-body font-bold">按你的节奏，稳稳向前</h3><p class="mt-1 text-caption text-stone">每天 {{ state.plan.dailyMinutes }} 分钟 · 按原速观看估算</p></div><p class="text-heading-sm">{{ schedule.days }}<span class="ml-1 text-body-sm font-medium text-stone">天{{ schedule.completed ? '剩余' : '预计' }}</span></p></div>
              <p class="mt-3 text-body-sm text-graphite">精选 {{ formatStudyDuration(schedule.totalSeconds) }} · 剩余 {{ formatStudyDuration(schedule.remainingSeconds) }} · 已完成 {{ schedule.completed }}/{{ guide.route.value.length }} 节</p>
              <p v-if="schedule.unknown" class="mt-2 text-caption text-stone">{{ schedule.unknown }} 节时长未知，暂按已知课节中位数（无数据时按 20 分钟）估算，读取后自动更新。</p>
              <ol class="mt-5 space-y-4">
                <li v-for="(milestone, i) in schedule.milestones" :key="`${milestone.moduleId}-${i}`" class="flex items-start gap-3">
                  <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption font-bold" :class="milestone.done ? 'bg-charcoal-ink text-white' : 'bg-sunbeam-yellow/30'">{{ milestone.done ? '✓' : i + 1 }}</span>
                  <div class="min-w-0 flex-1"><p class="text-body-sm font-bold">{{ moduleMap.get(milestone.moduleId)?.title }}</p><p class="mt-0.5 text-caption text-stone">{{ milestone.done ? '已完成' : `第 ${milestone.startDay}${milestone.endDay > milestone.startDay ? `–${milestone.endDay}` : ''} 天 · ${formatStudyDuration(milestone.remainingSeconds)}` }}</p></div>
                </li>
              </ol>
              <p class="mt-4 text-caption text-stone">预估仅包含观看时间，可为笔记和练习额外留出时间。</p>
            </section>

            <section class="pane p-5">
              <h3 class="text-body font-bold">每一节，都由你决定</h3>
              <p class="mt-1 text-caption leading-relaxed text-stone">观看完成和知识掌握分开记录。全部知识点标为已掌握时略过本课；需要补学时加入必修，不确定时保守查漏。</p>
              <input v-model="lessonQuery" type="search" aria-label="搜索路线课节或知识点" placeholder="搜索课节或知识点" class="guide-input mt-4" />
              <div v-if="pending" ref="pendingAlert" role="alert" class="mt-4 rounded-xl border border-brand-orange/40 bg-brand-orange/8 p-4">
                <p class="text-body-sm font-bold">这个调整会留下前置知识缺口</p>
                <p class="mt-2 text-body-sm">{{ pending.risks.map(r => `「${title(r.prerequisite)}」`).join('、') }}仍被路线中的后续课程依赖。</p>
                <div class="mt-3 flex flex-wrap gap-2"><UiButton size="sm" @click="pending = null">保留当前安排</UiButton><UiButton variant="text" size="sm" @click="confirmStatus">我已掌握，仍然调整</UiButton></div>
              </div>
              <ul class="mt-2 divide-y divide-linen">
                <li v-for="lesson in visibleLessons" :key="lesson.path" class="py-4">
                  <div class="flex items-start gap-3"><button type="button" class="min-w-0 flex-1 text-left text-body-sm font-bold hover:underline" :title="lesson.path" @click="emit('select', lesson.path); emit('close')">{{ title(lesson.path) }}</button>
                    <select :value="lesson.status" :aria-label="`${title(lesson.path)} 学习状态`" :disabled="!!state.busy" class="max-w-32 rounded-full border border-linen bg-page-cream px-2 py-1 text-caption" @change="requestStatus(lesson.path, $event)"><option v-for="(label, status) in LESSON_STATUS_LABELS" :key="status" :value="status">{{ label }}</option></select>
                  </div>
                  <p class="mt-2 text-caption leading-relaxed text-stone">AI 建议依据：{{ lesson.reason }}</p>
                  <p v-if="lesson.prerequisites.length" class="mt-1 text-caption leading-relaxed text-deep-indigo">先修：{{ lesson.prerequisites.map(title).join('、') }}</p>
                  <ConceptMastery :lesson="lesson" />
                </li>
              </ul>
              <p v-if="!visibleLessons.length" class="py-8 text-center text-body-sm text-stone">没有匹配的课节</p>
            </section>
          </div>
        </div>

        <section v-show="tab === 'map'">
          <div class="mb-5"><h3 class="text-heading-sm">先看清全貌，再选择方向</h3><p class="mt-2 text-body-sm text-stone">按知识主题归类；每个板块显示先修关系，展开可查看具体课节依赖。</p></div>
          <div v-if="!state.plan" class="pane p-10 text-center"><p class="text-body-sm text-stone">生成路线后，这里会展示整个课程的知识地图。</p><UiButton class="mt-4" @click="tab = 'plan'">去定制路线</UiButton></div>
          <div v-else class="grid items-start gap-4 sm:grid-cols-2">
            <article v-for="(module, i) in state.plan.modules" :key="module.id" class="pane p-5">
              <div class="flex items-center gap-3"><span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sunbeam-yellow/25 font-bold">{{ String(i + 1).padStart(2, '0') }}</span><h4 class="text-body font-bold">{{ module.title }}</h4><span class="ml-auto shrink-0 text-caption text-stone">{{ moduleLessons(module.id).length }} 节</span></div>
              <p class="mt-3 text-body-sm leading-relaxed text-graphite">{{ module.description }}</p>
              <p class="mt-3 rounded-lg bg-page-cream p-3 text-caption text-deep-indigo">{{ moduleDependencies(module.id).length ? `先修板块：${moduleDependencies(module.id).join('、')}` : '起点板块 · 无跨板块前置依赖' }}</p>
              <details class="mt-4"><summary class="cursor-pointer text-body-sm font-bold">知识点与课节依赖</summary><ul class="mt-2 divide-y divide-linen"><li v-for="lesson in moduleLessons(module.id)" :key="lesson.path" class="py-3"><div class="flex items-start gap-2"><button class="min-w-0 flex-1 text-left text-body-sm hover:underline" @click="emit('select', lesson.path); emit('close')">{{ title(lesson.path) }}</button><LessonBadge :status="lesson.status" compact /></div><ConceptMastery :lesson="lesson" /><p v-if="lesson.prerequisites.length" class="mt-1 text-caption text-deep-indigo">先学：{{ lesson.prerequisites.map(title).join('、') }}</p></li></ul></details>
            </article>
          </div>
          <p class="mt-4 text-caption text-stone">知识结构来自 AI 对标题的分析，建议结合实际课程内容核对。</p>
        </section>

        <section v-show="tab === 'help'" class="mx-auto max-w-2xl space-y-5">
          <div><p class="text-caption font-bold text-stone">卡住了，就退一小步</p><h3 class="mt-2 text-heading-sm">找到你缺的那块基础</h3><p class="mt-2 text-body-sm leading-relaxed text-graphite">描述具体疑问，AI 会从此前跳过的基础课中寻找补充内容。有同名 SRT / VTT 字幕时，可直接回看对应片段。</p></div>
          <div v-if="!state.plan" class="pane p-5"><p class="text-body-sm text-stone">先定制路线，才能知道哪些基础课被跳过。</p><UiButton class="mt-3" @click="tab = 'plan'">去定制路线</UiButton></div>
          <form ref="questionForm" class="pane p-5" @submit.prevent="findFallback">
            <div class="mb-3 flex items-start justify-between gap-3"><p class="text-caption text-stone">提问位置：{{ title(questionSource.path) || '尚未选择' }} · {{ formatTime(questionSource.seconds, true) }}</p><button type="button" class="shrink-0 text-caption underline" :disabled="!!state.busy" @click="newQuestion">记录新疑问</button></div>
            <label class="block text-body-sm font-bold">哪里没理解？<textarea v-model="question" required maxlength="3000" rows="4" :disabled="!!state.busy" class="guide-input mt-2 font-normal" placeholder="例如：为什么 Spring 能通过注解找到并创建对象？反射在这里起了什么作用？" /></label>
            <div class="mt-4 flex flex-wrap items-center gap-3"><UiButton size="sm" :disabled="!!state.busy || !question.trim()" @click="saveQuestionDraft">存入疑问清单</UiButton><UiButton variant="primary" type="submit" :disabled="!!state.busy || !currentVideo || !state.plan">帮我找基础课</UiButton></div>
            <p v-if="editingQuestionId" role="status" class="mt-3 text-caption text-stone">此疑问已记录，回看后可以在清单中反馈是否解决。</p>
          </form>
          <div v-if="state.fallbackMessage" role="status"><p class="text-body-sm font-bold">{{ state.fallbackMessage }}</p><p class="mt-2 text-caption text-stone">来自「{{ title(state.fallbackSource) }}」的疑问：{{ state.fallbackQuestion }}</p></div>
          <article v-for="rec in state.recommendations" :key="rec.path" class="pane p-5">
            <div class="flex items-start gap-3"><h4 class="flex-1 text-body font-bold">{{ title(rec.path) }}</h4><LessonBadge :status="guide.lessonMap.value.get(rec.path)?.status ?? 'skipped'" compact /></div>
            <p class="mt-3 text-body-sm leading-relaxed text-graphite">{{ rec.reason }}</p>
            <blockquote v-if="rec.cue" class="mt-3 rounded-xl bg-page-cream p-3 text-body-sm leading-relaxed"><p class="mb-1 text-caption font-bold text-stone">字幕证据 · {{ formatTime(rec.cue.start, true) }}–{{ formatTime(rec.cue.end, true) }}</p>{{ rec.cue.text }}</blockquote>
            <p v-else class="mt-3 text-caption text-stone">没有可验证的相关字幕片段，将从本课开头回看。</p>
            <div class="mt-4 flex flex-wrap gap-2"><UiButton variant="dark" size="sm" @click="jumpBack(rec.path, rec.cue?.start)">{{ rec.cue ? '回看这个片段' : '回看基础课' }}</UiButton><UiButton size="sm" :disabled="!!state.busy || guide.lessonMap.value.get(rec.path)?.status === 'required'" @click="guide.setStatus(rec.path, 'required')">{{ guide.lessonMap.value.get(rec.path)?.status === 'required' ? '已加入必修' : '加入必修路线' }}</UiButton></div>
          </article>
          <QuestionInbox @select="loadQuestion" @seek="(path, seconds) => { emit('select', path, seconds); emit('close') }" />
        </section>

        <section v-show="tab === 'settings'" class="mx-auto max-w-xl">
          <h3 class="text-heading-sm">连接你的 AI 老师</h3><p class="mt-2 text-body-sm leading-relaxed text-graphite">支持 OpenAI 兼容服务，也可以使用本机 Ollama。填写服务的 API 基础地址和已开通的模型名称。</p>
          <form class="pane mt-5 space-y-4 p-5" @submit.prevent="saveSettings">
            <label class="block text-body-sm font-bold">服务地址<input v-model="settings.baseUrl" type="url" required autocomplete="off" :disabled="!!state.busy" class="guide-input mt-2 font-normal" placeholder="https://api.example.com/v1" /></label>
            <p class="text-caption text-stone">包含 /v1 等接口前缀。例如本机服务：http://localhost:11434/v1</p>
            <label class="block text-body-sm font-bold">模型名称<input v-model="settings.model" required autocomplete="off" :disabled="!!state.busy" class="guide-input mt-2 font-normal" placeholder="填写服务提供商支持的模型 ID" /></label>
            <label class="block text-body-sm font-bold">API 密钥<input v-model="settings.apiKey" type="password" autocomplete="off" :disabled="!!state.busy" class="guide-input mt-2 font-normal" placeholder="本机无鉴权服务可留空" /></label>
            <label class="block text-body-sm font-bold">
              响应超时时长（分钟）
              <input
                v-model.number="settings.timeoutMinutes"
                type="number"
                min="1"
                max="30"
                step="1"
                autocomplete="off"
                :disabled="!!state.busy"
                class="guide-input mt-2 font-normal"
                placeholder="最高 30 分钟（默认 15 分钟）"
              />
            </label>
            <p class="text-caption leading-relaxed text-stone">AI 响应最高允许 30 分钟（范围 1 ~ 30 分钟，默认 15 分钟）。对于长视频课程、本地 Ollama 慢速模型或深度思考大模型，可调高超时时长避免生成中断。配置与 API 密钥已通过 SQLite 数据库持久化存储在本地，刷新页面或重启后不会丢失。</p>
            <div class="rounded-xl bg-page-cream p-4 text-caption leading-relaxed text-graphite">生成或调整路线会发送课程标题、相对路径、时长、观看完成状态、导学对话、掌握标记和已记录的疑问及解决状态；卡点回溯还会发送你提交的疑问和相关字幕片段。小练习仅在主动生成或提交作答时发送选取的字幕、本课笔记文字、补充材料与作答。视频与截图不会上传。单独记录反馈和调整今日安排不请求 AI。</div>
            <p v-if="settingsError" role="alert" class="text-body-sm text-error">{{ settingsError }}</p><p v-if="settingsMessage" role="status" class="text-body-sm text-graphite">{{ settingsMessage }}</p>
            <div class="flex gap-2"><UiButton type="submit" variant="primary" :disabled="!!state.busy">保存设置</UiButton><UiButton v-if="guide.configured.value" @click="tab = 'plan'">返回定制路线</UiButton></div>
          </form>
        </section>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
@reference '../styles/main.css';
.guide-input { @apply w-full rounded-xl border border-linen bg-pure-white px-3 py-2.5 text-body-sm text-charcoal-ink placeholder:text-stone focus:border-charcoal-ink focus:outline-none disabled:opacity-50; }
</style>

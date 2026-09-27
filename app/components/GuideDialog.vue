<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import { usePlayer } from '~/composables/usePlayer'
import { formatTime } from '~/utils/time'
import AiProfileSelector from '~/components/AiProfileSelector.vue'
import AiSettingsPanel from '~/components/AiSettingsPanel.vue'
import AppIcon from '~/components/AppIcon.vue'
import ConceptMastery from '~/components/ConceptMastery.vue'
import LessonBadge from '~/components/LessonBadge.vue'
import ProgramSettings from '~/components/ProgramSettings.vue'
import RoutePreview from '~/components/RoutePreview.vue'
import GuideModuleCard from '~/components/GuideModuleCard.vue'
import QuestionInbox from '~/components/QuestionInbox.vue'
import TodayPlanPanel from '~/components/TodayPlanPanel.vue'
import UiButton from '~/components/UiButton.vue'
import type { VideoEntry } from '~/types/course'
import type { DependencyRisk, GuideLesson, LessonStatus, TodayItem } from '~/types/guide'
import { formatStudyDuration, LESSON_STATUS_LABELS } from '~/utils/guide'
import { conciseLessonTitle, conciseSource } from '~/utils/studyProgram'

const props = defineProps<{ open: boolean; currentVideo: VideoEntry | null; initialQuestion?: string; initialTab?: 'plan' | 'today' | 'help' | 'settings' }>()
const emit = defineEmits<{ close: []; select: [path: string, seconds?: number, returning?: boolean, questionId?: string]; segment: [item: TodayItem] }>()
const guide = useGuide()
const { state, schedule, counts, risks } = guide
const tab = ref<'plan' | 'map' | 'help' | 'settings' | 'today'>('plan')
const draft = ref('')
const dailyMinutes = ref(state.plan?.dailyMinutes ?? 120)
const question = ref('')
const editingQuestionId = ref('')
const questionSource = ref({ path: '', seconds: 0 })
const player = usePlayer()
const questionForm = ref<HTMLElement>()
const pending = ref<{ path: string; status: LessonStatus; risks: DependencyRisk[] } | null>(null)
const pendingAlert = ref<HTMLElement>()
const lessonQuery = ref('')
const planView = ref<'overview' | 'lessons' | 'settings'>('overview')
const expandedLesson = ref<string>()
const planTop = ref<HTMLElement>()
const planHeading = ref<HTMLElement>()
const tabs = [{ id: 'today', label: '今日学习' }, { id: 'plan', label: '定制路线' }, { id: 'map', label: '知识地图' }, { id: 'help', label: '疑问回溯' }, { id: 'settings', label: 'AI 设置' }] as const
const examples = [
  '已掌握 Java 基础，目标是完成 Spring Boot 项目开发，每日可学习 2 小时。',
  '无相关基础，计划系统学习本课程，每日可学习 1 小时。',
  '具备相关经验，重点补充知识并学习项目实战，每日可学习 30 分钟。',
]
const visibleLessons = computed(() => guide.arrangedLessons.value.filter(l => {
  const q = lessonQuery.value.trim().toLowerCase()
  return !q || `${l.path} ${l.concepts.join(' ')}`.toLowerCase().includes(q)
}))
const lessonPage = ref(1)
const pageSize = 12
const pageCount = computed(() => Math.max(1, Math.ceil(visibleLessons.value.length / pageSize)))
const currentPage = computed(() => Math.min(lessonPage.value, pageCount.value))
const pageLessons = computed(() => visibleLessons.value.slice((currentPage.value - 1) * pageSize, currentPage.value * pageSize))
const statusItems = Object.entries(LESSON_STATUS_LABELS).map(([value, title]) => ({ title, value }))
// Keep the lightweight plan form mounted after visiting it so unfinished edits survive tab changes.
// The large lesson controls are mounted only on the active page.
const planVisited = ref(false)
const lessonsByModule = computed(() => {
  const groups = new Map<string, GuideLesson[]>()
  for (const lesson of guide.arrangedLessons.value) {
    if (!groups.has(lesson.moduleId)) groups.set(lesson.moduleId, [])
    groups.get(lesson.moduleId)!.push(lesson)
  }
  return groups
})
watch(lessonQuery, () => { lessonPage.value = 1 })
watch([currentPage, lessonQuery], () => { expandedLesson.value = undefined })
const moduleMap = computed(() => new Map(state.plan?.modules.map(m => [m.id, m]) ?? []))
const first = computed(() => guide.firstLesson.value)

/** 精简标题用于列表与说明，原文件名通过 title 提示与来源保留。 */
function title(path: string) { const v = guide.videoMap.value.get(path); return v ? conciseLessonTitle(v.title) : path }
function fullTitle(path: string) { return guide.videoMap.value.get(path)?.title ?? path }
function source(path: string) { return conciseSource(guide.videoMap.value.get(path)?.dir ?? '') }
function revisionTime(at: number) { const d = new Date(at); return at ? `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '' }
watch(() => props.open, async open => {
  if (open) {
    tab.value = props.initialTab ?? 'plan'
    planView.value = 'overview'
    expandedLesson.value = undefined
    dailyMinutes.value = state.plan?.dailyMinutes ?? 120
    if (props.initialQuestion !== undefined) {
      question.value = props.initialQuestion; tab.value = 'help'
      editingQuestionId.value = guide.activeQuestion.value?.id ?? ''
    }
    const entry = state.questions.find(q => q.id === editingQuestionId.value)
    questionSource.value = entry ? { path: entry.path, seconds: entry.seconds }
      : { path: props.currentVideo?.path ?? '', seconds: player.state.currentTime }
  }
})
watch([() => props.open, tab], ([open, activeTab]) => {
  if (!open) planVisited.value = false
  else if (activeTab === 'plan') planVisited.value = true
}, { immediate: true })
watch(() => props.initialQuestion, value => { if (value !== undefined) { question.value = value; tab.value = 'help' } })
watch(() => state.plan, () => { pending.value = null; dailyMinutes.value = state.plan?.dailyMinutes ?? dailyMinutes.value })
// 完整计划或导入可能修改看课时间，输入框随之同步。
watch(() => state.plan?.dailyMinutes, value => { if (value) dailyMinutes.value = value })
watch(pending, async value => { if (value) { await nextTick(); pendingAlert.value?.scrollIntoView({ block: 'nearest' }) } })

async function generate() {
  if (!guide.configured.value) { tab.value = 'settings'; state.error = '请先配置 AI 服务，再生成学习路线。'; return }
  if (await guide.generate(draft.value, Number(dailyMinutes.value))) {
    draft.value = ''; pending.value = null
    await showPlanView('overview')
  }
}
async function showPlanView(view: 'overview' | 'lessons' | 'settings') {
  planView.value = view
  await nextTick()
  planTop.value?.parentElement?.scrollTo({ top: 0 })
  planHeading.value?.focus({ preventScroll: true })
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
function requestStatus(path: string, value: string | null) {
  if (!value) return
  const status = value as LessonStatus
  const original = guide.lessonMap.value.get(path)?.status ?? 'optional'
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
async function findFallback() {
  const entry = saveQuestionDraft()
  if (!entry) return
  if (!guide.configured.value) { tab.value = 'settings'; state.error = '请先配置 AI 服务，再查找基础课。'; return }
  const video = guide.videoMap.value.get(entry.path)
  if (video) await guide.findFallback(question.value, video, entry.seconds, entry.id)
}
function saveQuestionDraft() {
  const entry = guide.saveQuestion(question.value, questionSource.value.path, questionSource.value.seconds, editingQuestionId.value)
  if (!entry) { state.error = '请填写疑问并选择对应课节。'; return }
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
  <VDialog :model-value="open" aria-labelledby="guide-title" width="1120" @update:model-value="!$event && emit('close')">
    <div class="paper-dialog h-[min(90dvh,900px)]">
    <div class="flex h-full flex-col">
      <header class="flex shrink-0 items-center justify-between gap-3 border-b border-linen bg-pure-white px-5 py-4 sm:px-7">
        <div class="flex items-center gap-3">
          <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-sunbeam-yellow"><AppIcon name="sparkles" :size="24" /></span>
          <div><h2 id="guide-title" class="text-subheading">AI 导学</h2></div>
        </div>
        <UiButton variant="text" size="sm" icon title="关闭导学" @click="emit('close')"><AppIcon name="close" :size="20" /></UiButton>
      </header>
      <nav class="flex shrink-0 gap-1 overflow-x-auto border-b border-linen bg-pure-white px-4 py-2" aria-label="导学功能">
        <UiButton v-for="item in tabs" :key="item.id" size="sm" :aria-current="tab === item.id ? 'page' : undefined"
          :variant="tab === item.id ? 'dark' : 'text'" @click="tab = item.id">{{ item.label }}</UiButton>
      </nav>

      <div v-if="state.error || state.storageError" role="alert" class="flex shrink-0 items-start gap-3 border-b border-error/20 bg-pure-white px-6 py-3 text-body-sm text-error">
        <p class="flex-1">{{ state.error || state.storageError }}</p>
        <UiButton variant="text" size="sm" @click="state.error = ''; state.storageError = ''">关闭提示</UiButton>
      </div>
      <div v-if="state.busy" role="status" class="flex shrink-0 items-center justify-between gap-3 border-b border-linen bg-pure-white px-6 py-3 text-body-sm">
        <span>{{ state.busy === 'plan' ? '正在生成学习路线…' : state.busy === 'practice' ? '正在生成实践安排…' : '正在查找基础课与字幕…' }}</span>
        <UiButton variant="text" size="sm" @click="guide.cancel()">取消</UiButton>
      </div>

      <div class="scroll-soft min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div v-if="tab !== 'settings' && tab !== 'plan'" class="mb-5 flex flex-wrap items-center justify-between gap-3">
          <AiProfileSelector class="w-full sm:max-w-sm" :disabled="!!state.busy" />
          <UiButton variant="text" size="sm" @click="tab = 'settings'">管理 AI 配置</UiButton>
        </div>
        <TodayPlanPanel v-if="tab === 'today'" @segment="item => { emit('segment', item); emit('close') }" @question="loadQuestion" @plan="tab = 'plan'" />
        <div v-if="planVisited" v-show="tab === 'plan'" ref="planTop" class="mx-auto max-w-4xl space-y-5">
          <RoutePreview />
          <p v-if="state.notice" role="status" class="text-body-sm text-stone">{{ state.notice }}</p>

          <template v-if="state.plan">
            <header class="flex flex-wrap items-center justify-between gap-4">
              <div class="min-w-0">
                <UiButton v-if="planView !== 'overview'" variant="text" size="sm" class="mb-2" @click="showPlanView('overview')"><AppIcon name="chevron-right" class="rotate-180" :size="16" />返回学习路线</UiButton>
                <h3 ref="planHeading" tabindex="-1" class="text-heading-sm focus:outline-none">{{ planView === 'overview' ? '学习路线' : planView === 'lessons' ? '课节安排' : '调整路线' }}</h3>
                <p v-if="planView === 'overview'" class="mt-2 text-body-sm text-stone">{{ counts.required }} 节必修 · {{ counts.optional }} 节选修 · {{ counts.skipped }} 节已跳过</p>
              </div>
              <div v-if="planView === 'overview'" class="flex flex-wrap items-center gap-2">
                <UiButton size="sm" @click="showPlanView('settings')">调整路线</UiButton>
                <UiButton variant="dark" size="sm" :disabled="!first || !!state.busy" @click="start"><AppIcon name="play" :size="16" />{{ schedule.completed === guide.route.value.length ? '重新学习' : schedule.completed ? '继续学习' : '开始学习' }}</UiButton>
              </div>
            </header>

            <div v-if="risks.length" role="alert" class="rounded-xl border border-brand-orange/30 bg-pure-white p-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-body-sm font-bold">{{ risks.length }} 节前置课未加入路线</p>
                <UiButton size="sm" :disabled="!!state.busy" @click="guide.repairDependencies()">补齐前置课</UiButton>
              </div>
              <VExpansionPanels class="mt-3">
                <VExpansionPanel title="查看前置关系">
                  <VExpansionPanelText>
                    <p v-for="risk in risks" :key="risk.prerequisite" class="mt-2 text-caption leading-relaxed">「{{ title(risk.prerequisite) }}」是「{{ risk.dependents.map(title).join('、') }}」的前置课。</p>
                  </VExpansionPanelText>
                </VExpansionPanel>
              </VExpansionPanels>
            </div>
          </template>

          <section v-if="state.plan && planView === 'overview'" class="pane p-5 sm:p-6" aria-label="学习顺序">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div><h4 class="text-body font-bold">学习顺序</h4><p class="mt-1 text-caption text-stone">已观看 {{ schedule.completed }}/{{ guide.route.value.length }} 节 · 剩余 {{ formatStudyDuration(schedule.remainingSeconds) }}</p></div>
              <UiButton variant="text" size="sm" @click="showPlanView('lessons')">课节安排<AppIcon name="chevron-right" :size="16" /></UiButton>
            </div>
            <p class="mt-3 text-caption text-stone">以下天数按每日观看 {{ state.plan.dailyMinutes }} 分钟、原速播放估算。</p>
            <ol class="mt-4 divide-y divide-linen">
              <li v-for="(milestone, i) in schedule.milestones" :key="`${milestone.moduleId}-${i}`" class="flex items-start gap-3 py-4">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-caption font-bold" :class="milestone.done ? 'bg-charcoal-ink text-white' : 'border border-linen'">{{ milestone.done ? '✓' : i + 1 }}</span>
                <div class="min-w-0 flex-1"><p class="text-body-sm font-bold leading-7 [overflow-wrap:anywhere]">{{ moduleMap.get(milestone.moduleId)?.title }}</p><p class="mt-1 text-caption text-stone">{{ milestone.done ? '已完成观看' : `第 ${milestone.startDay}${milestone.endDay > milestone.startDay ? `–${milestone.endDay}` : ''} 天 · ${formatStudyDuration(milestone.remainingSeconds)}` }}</p></div>
              </li>
            </ol>
            <p v-if="!schedule.milestones.length" class="py-6 text-body-sm text-stone">当前路线没有课节，可在课节安排中添加。</p>
            <VExpansionPanels class="mt-4">
              <VExpansionPanel value="schedule">
                <VExpansionPanelTitle>视频排期详情</VExpansionPanelTitle>
                <VExpansionPanelText>
                  <p class="text-body-sm text-graphite">每日观看 {{ state.plan.dailyMinutes }} 分钟 · 按原速估算剩余约 {{ schedule.days }} 天</p>
                  <p class="mt-2 text-caption text-stone">总时长 {{ formatStudyDuration(schedule.totalSeconds) }}<template v-if="guide.program.value"> · 完整计划共 {{ guide.program.value.days }} 天</template></p>
                  <p v-if="schedule.unknown" class="mt-2 text-caption text-stone">{{ schedule.unknown }} 节时长未知，暂按已知课节中位数（无数据时按 20 分钟）估算，读取后自动更新。</p>
                  <p class="mt-2 text-caption text-stone">{{ guide.program.value ? (guide.videoFinish.value === null ? '路线视频已全部观看。' : guide.videoFinish.value === Infinity ? '当前未分配观看时间。' : `按阶段时间分配，预计第 ${guide.videoFinish.value} 天完成观看。`) : '排期仅统计视频，不含实践时间。' }}</p>
                </VExpansionPanelText>
              </VExpansionPanel>
              <VExpansionPanel value="summary">
                <VExpansionPanelTitle>路线说明</VExpansionPanelTitle>
                <VExpansionPanelText>
                  <p class="whitespace-pre-wrap break-words text-body-sm leading-relaxed text-graphite">{{ state.plan.summary }}</p>
                  <UiButton variant="text" size="sm" class="mt-3" @click="guide.exportPlan()">导出路线</UiButton>
                </VExpansionPanelText>
              </VExpansionPanel>
            </VExpansionPanels>
          </section>

          <section v-show="!state.plan || planView === 'settings'" class="pane p-5 sm:p-6">
            <h3 v-if="!state.plan" class="text-heading-sm">学习背景与目标</h3>
            <p v-if="!state.plan" class="mt-2 text-caption text-stone">已读取 {{ guide.videoMap.value.size }} 节课程</p>
            <form class="space-y-5" :class="!state.plan && 'mt-5'" @submit.prevent="generate">
              <VTextarea v-model="draft" required maxlength="6000" rows="4" :disabled="!!state.busy" :label="state.plan ? '调整要求' : '规划要求'"
                placeholder="例如：已掌握 Java 基础，目标是完成 Spring Boot 项目开发。" />
              <div v-if="!state.plan" class="flex flex-wrap gap-2">
                <UiButton v-for="(example, index) in examples" :key="example" size="sm" :disabled="!!state.busy" @click="draft = example">{{ ['项目开发', '系统入门', '知识巩固'][index] }}</UiButton>
              </div>
              <div class="flex flex-wrap items-end gap-4">
                <AiProfileSelector class="min-w-0 flex-1 basis-64" :disabled="!!state.busy" />
                <VTextField v-model.number="dailyMinutes" :label="state.plan?.program ? '每日观看时间' : '每日学习时间'" suffix="分钟" aria-label="每日学习分钟数" type="number" min="5" max="1440" step="1" required :disabled="!!state.busy" class="w-44 flex-none" @change="updateDailyMinutes" />
              </div>
              <p class="text-caption leading-relaxed text-stone">仅依据标题与时长规划，不上传视频。<template v-if="state.scanning">时长读取中 {{ state.scanned }}/{{ guide.videoMap.value.size }}，可先生成路线。</template></p>
              <div class="flex flex-wrap items-center gap-3">
                <UiButton type="submit" variant="primary" :disabled="!!state.busy || !guide.guideReady.value"><AppIcon name="sparkles" :size="18" />{{ state.plan ? '生成调整方案' : '生成学习路线' }}</UiButton>
                <UiButton variant="text" size="sm" @click="tab = 'settings'">{{ guide.configured.value ? '管理 AI 配置' : '配置 AI 服务' }}</UiButton>
              </div>
            </form>
            <VExpansionPanels v-if="state.plan" class="mt-6">
              <VExpansionPanel value="program">
                <VExpansionPanelTitle>完整学习计划</VExpansionPanelTitle>
                <VExpansionPanelText eager><ProgramSettings class="!mt-0 !border-t-0 !pt-0" @settings="tab = 'settings'" /></VExpansionPanelText>
              </VExpansionPanel>
              <VExpansionPanel value="background">
                <VExpansionPanelTitle>学习背景与导学对话</VExpansionPanelTitle>
                <VExpansionPanelText>
                  <p class="whitespace-pre-wrap break-words text-body-sm leading-relaxed">{{ state.plan.profile }}</p>
                  <div v-if="state.plan.messages.length" class="mt-4 max-h-72 space-y-3 overflow-y-auto">
                    <div v-for="(message, index) in state.plan.messages" :key="index" class="rounded-xl border border-linen bg-pure-white p-3">
                      <p class="mb-1 text-caption font-bold text-stone">{{ message.role === 'user' ? '学习者' : 'AI 导学' }}</p><p class="whitespace-pre-wrap break-words leading-relaxed">{{ message.content }}</p>
                    </div>
                  </div>
                </VExpansionPanelText>
              </VExpansionPanel>
            </VExpansionPanels>
          </section>

          <section v-if="state.plan && planView === 'lessons' && tab === 'plan'" class="pane p-5 sm:p-6">
            <div class="flex flex-wrap items-center gap-4">
              <VTextField :model-value="lessonQuery" type="search" label="搜索课节或知识点" clearable class="min-w-0 flex-1 basis-64" @update:model-value="lessonQuery = $event ?? ''">
                <template #prepend-inner><AppIcon name="search" :size="18" /></template>
              </VTextField>
              <VCheckbox v-model="state.includeOptional" label="将选修课加入路线" :disabled="!!state.busy" class="shrink-0" />
            </div>
            <div v-if="pending" ref="pendingAlert" role="alert" class="mt-4 rounded-xl border border-brand-orange/40 bg-pure-white p-4">
              <p class="text-body-sm font-bold">调整后将缺少前置课</p>
              <p class="mt-2 text-body-sm">{{ pending.risks.map(r => `「${title(r.prerequisite)}」`).join('、') }}是后续课节的前置课。</p>
              <div class="mt-3 flex flex-wrap gap-2"><UiButton size="sm" @click="pending = null">保留当前安排</UiButton><UiButton variant="text" size="sm" @click="confirmStatus">确认调整</UiButton></div>
            </div>
            <nav v-if="pageCount > 1" aria-label="课节分页" class="mt-4 flex flex-wrap items-center justify-between gap-2">
              <UiButton size="sm" :disabled="currentPage === 1" @click="lessonPage = currentPage - 1" aria-label="上一页课节">上一页</UiButton>
              <span class="text-caption text-stone">第 {{ currentPage }} / {{ pageCount }} 页 · 共 {{ visibleLessons.length }} 节</span>
              <UiButton size="sm" :disabled="currentPage === pageCount" @click="lessonPage = currentPage + 1" aria-label="下一页课节">下一页</UiButton>
            </nav>
            <VExpansionPanels v-if="pageLessons.length" v-model="expandedLesson" class="mt-4" aria-label="课节安排">
              <VExpansionPanel v-for="lesson in pageLessons" :key="lesson.path" :value="lesson.path" :data-path="lesson.path" :data-route-position="guide.routePositions.value.get(lesson.path)">
                <VExpansionPanelTitle>
                  <span class="w-7 shrink-0 text-caption text-stone" :aria-label="guide.routePositions.value.has(lesson.path) ? `路线第 ${guide.routePositions.value.get(lesson.path)} 节` : '未加入当前路线'">{{ guide.routePositions.value.get(lesson.path) ?? '—' }}</span>
                  <span class="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]" :title="fullTitle(lesson.path)">{{ title(lesson.path) }}</span>
                  <LessonBadge :status="lesson.status" compact />
                </VExpansionPanelTitle>
                <VExpansionPanelText>
                  <template v-if="expandedLesson === lesson.path">
                    <p class="text-caption text-stone">{{ moduleMap.get(lesson.moduleId)?.title }}<template v-if="source(lesson.path)"> · {{ source(lesson.path) }}</template></p>
                    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <VSelect :model-value="lesson.status" :items="statusItems" label="学习状态" :aria-label="`${fullTitle(lesson.path)} 学习状态`" :disabled="!!state.busy" class="w-36 max-w-40 flex-none" @update:model-value="requestStatus(lesson.path, $event)" />
                      <UiButton variant="text" size="sm" @click="emit('select', lesson.path); emit('close')"><AppIcon name="play" :size="16" />播放课节</UiButton>
                    </div>
                    <p class="mt-4 text-body-sm leading-relaxed text-graphite">{{ lesson.reason }}</p>
                    <p v-if="lesson.prerequisites.length" class="mt-2 text-caption leading-relaxed text-deep-indigo">前置课：{{ lesson.prerequisites.map(title).join('、') }}</p>
                    <ConceptMastery :lesson="lesson" />
                    <p class="mt-2 text-caption leading-relaxed text-stone">全部知识点标为“已掌握”时跳过本课；“需要补学”时加入必修；“不确定”时保留查漏。观看进度独立记录。</p>
                  </template>
                </VExpansionPanelText>
              </VExpansionPanel>
            </VExpansionPanels>
            <p v-else class="py-8 text-center text-body-sm text-stone">未找到匹配的课节</p>
          </section>

          <div v-if="state.plan && state.records.undo" class="flex flex-wrap items-center justify-between gap-2 text-caption">
            <span class="min-w-0 text-stone [overflow-wrap:anywhere]">上次调整：{{ state.records.undo.label }}<template v-if="state.records.undo.at"> · {{ revisionTime(state.records.undo.at) }}</template></span>
            <UiButton variant="text" size="sm" :disabled="!!state.busy" @click="guide.undo()">撤销上次调整</UiButton>
          </div>
        </div>

        <section v-if="tab === 'map'">
          <div class="mb-5"><h3 class="text-heading-sm">课程知识结构</h3></div>
          <div v-if="!state.plan" class="pane p-10 text-center"><p class="text-body-sm text-stone">生成学习路线后，可查看课程知识地图。</p><UiButton class="mt-4" @click="tab = 'plan'">定制学习路线</UiButton></div>
          <div v-else class="grid items-start gap-4 sm:grid-cols-2">
            <GuideModuleCard v-for="(module, i) in state.plan.modules" :key="module.id" :module="module" :index="i"
              :lessons="lessonsByModule.get(module.id) ?? []" @select="emit('select', $event); emit('close')" />
          </div>
          <p class="mt-4 text-caption text-stone">知识结构依据课程标题生成，请结合课程内容核对。</p>
        </section>

        <section v-if="tab === 'help'" class="mx-auto max-w-2xl space-y-5">
          <div><h3 class="text-heading-sm">查找基础课</h3><p class="mt-2 text-body-sm leading-relaxed text-graphite">描述疑问，AI 将推荐此前跳过的基础课。有同名 SRT / VTT 字幕时可定位相关片段。</p></div>
          <div v-if="!state.plan" class="pane p-5"><p class="text-body-sm text-stone">生成学习路线后，可从已跳过的课节中查找基础课。</p><UiButton class="mt-3" @click="tab = 'plan'">定制学习路线</UiButton></div>
          <form ref="questionForm" class="pane p-5" @submit.prevent="findFallback">
            <div class="mb-3 flex items-center justify-between gap-3"><p class="text-caption text-stone">提问位置：{{ title(questionSource.path) || '尚未选择' }} · {{ formatTime(questionSource.seconds, true) }}</p><UiButton variant="text" size="sm" :disabled="!!state.busy" @click="newQuestion">记录新疑问</UiButton></div>
            <label class="block text-body-sm font-bold">疑问描述<VTextarea v-model="question" required maxlength="3000" rows="4" :disabled="!!state.busy"  placeholder="例如：Spring 如何通过注解创建对象？反射机制在此过程中起什么作用？" /></label>
            <div class="mt-4 flex flex-wrap items-center gap-3"><UiButton :disabled="!!state.busy || !question.trim()" @click="saveQuestionDraft">记录疑问</UiButton><UiButton variant="primary" type="submit" :disabled="!!state.busy || !currentVideo || !state.plan">查找基础课</UiButton></div>
          </form>
          <div v-if="state.fallbackMessage" role="status"><p class="text-body-sm font-bold">{{ state.fallbackMessage }}</p><p class="mt-2 text-caption text-stone">来自「{{ title(state.fallbackSource) }}」的疑问：{{ state.fallbackQuestion }}</p></div>
          <article v-for="rec in state.recommendations" :key="rec.path" class="pane p-5">
            <div class="flex items-start gap-3"><h4 class="flex-1 text-body font-bold">{{ title(rec.path) }}</h4><LessonBadge :status="guide.lessonMap.value.get(rec.path)?.status ?? 'skipped'" compact /></div>
            <p class="mt-3 text-body-sm leading-relaxed text-graphite">{{ rec.reason }}</p>
            <blockquote v-if="rec.cue" class="mt-3 rounded-xl bg-page-cream p-3 text-body-sm leading-relaxed"><p class="mb-1 text-caption font-bold text-stone">相关字幕 · {{ formatTime(rec.cue.start, true) }}–{{ formatTime(rec.cue.end, true) }}</p>{{ rec.cue.text }}</blockquote>
            <p v-else class="mt-3 text-caption text-stone">未找到相关字幕，将从课节起点播放。</p>
            <div class="mt-4 flex flex-wrap gap-2"><UiButton variant="dark" size="sm" @click="jumpBack(rec.path, rec.cue?.start)">{{ rec.cue ? '回看片段' : '回看基础课' }}</UiButton><UiButton size="sm" :disabled="!!state.busy || guide.lessonMap.value.get(rec.path)?.status === 'required'" @click="guide.setStatus(rec.path, 'required')">{{ guide.lessonMap.value.get(rec.path)?.status === 'required' ? '已加入必修' : '加入必修' }}</UiButton></div>
          </article>
          <QuestionInbox @select="loadQuestion" @seek="(path, seconds) => { emit('select', path, seconds); emit('close') }" />
        </section>

        <AiSettingsPanel v-if="tab === 'settings'" @done="tab = 'plan'" />
      </div>
    </div>
    </div>
  </VDialog>
</template>

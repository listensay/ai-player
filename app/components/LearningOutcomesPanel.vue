<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useLearningManagement } from '~/composables/useLearningManagement'
import { canAcceptWork } from '~/utils/learningManagement'
import { graduationReport } from '~/utils/learningOutcomes'
import { programDate, budgetTotal, addDays } from '~/utils/studyProgram'
import { exportStudyDigest } from '~/utils/studyDigestExport'
import { desktopInvoke } from '~/utils/platform'
import type { PortfolioWork } from '~/types/learningManagement'
import UiButton from './UiButton.vue'
import UiDatePicker from './UiDatePicker.vue'
import StudyFormDialog from './StudyFormDialog.vue'
const learning = useLearningManagement()
const courseId = ref(''),
  contractOpen = ref(false),
  workOpen = ref(false),
  error = ref(''),
  busy = ref(false)
const courseOptions = computed(() => learning.courses.value.map((c) => ({ title: c.course.name, value: c.course.id })))
watch(
  courseOptions,
  (options) => {
    if (!options.some((o) => o.value === courseId.value)) courseId.value = options[0]?.value ?? ''
  },
  { immediate: true },
)
const course = computed(() => learning.courses.value.find((c) => c.course.id === courseId.value))
const stages = computed(() => [
  { title: '整门课程', value: '' },
  ...(course.value?.context?.plan?.modules.map((m) => ({ title: m.title, value: m.id })) ?? []),
])
const works = computed(() => learning.state.data.works.filter((w) => w.courseId === courseId.value))
const contracts = computed(() => learning.state.data.contracts.filter((c) => c.courseId === courseId.value))
const contract = reactive({ moduleId: '', goal: '', deadline: '', minutes: 30 })
const work = reactive<PortfolioWork>({
  id: '',
  courseId: '',
  moduleId: '',
  title: '',
  description: '',
  location: '',
  screenshot: '',
  createdAt: 0,
  acceptedAt: null,
})
const report = computed(() =>
  course.value
    ? graduationReport(course.value, learning.state.data, learning.sources.value, learning.date.value)
    : null,
)
function openContract() {
  const p = course.value?.context?.plan?.program
  Object.assign(contract, {
    moduleId: '',
    goal: course.value?.context?.plan?.summary ?? '',
    deadline: p ? programDate(p, p.days) : addDays(learning.date.value, 30),
    minutes: p ? budgetTotal(p.budget) : 30,
  })
  error.value = ''
  contractOpen.value = true
}
watch(
  () => contract.moduleId,
  (id) => {
    const stage = course.value?.context?.plan?.modules.find((m) => m.id === id)?.practice
    if (stage) {
      contract.goal = stage.project || stage.goal
      const p = course.value?.context?.plan?.program
      if (p) contract.deadline = programDate(p, stage.endDay)
    }
  },
)
async function sign() {
  const id = courseId.value
  if (!id || !contract.goal.trim()) {
    error.value = '请填写交付目标。'
    return
  }
  const value = {
    ...contract,
    minutes: Number(contract.minutes),
    goal: contract.goal.trim(),
    id: crypto.randomUUID(),
    courseId: id,
    signedAt: Date.now(),
  }
  if (
    await learning.mutate((data) => {
      data.contracts = [...data.contracts.filter((c) => c.courseId !== id || c.moduleId !== value.moduleId), value]
    })
  )
    contractOpen.value = false
  else error.value = learning.state.error
}
function editWork(value?: PortfolioWork) {
  Object.assign(
    work,
    value ?? {
      id: '',
      courseId: courseId.value,
      moduleId: '',
      title: '',
      description: '',
      location: '',
      screenshot: '',
      createdAt: Date.now(),
      acceptedAt: null,
    },
  )
  error.value = ''
  workOpen.value = true
}
async function screenshot(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2000000) {
    error.value = '请选择 2 MB 以内的 PNG、JPEG 或 WebP 图片。'
    return
  }
  const reader = new FileReader()
  const key = work.id,
    id = work.courseId
  reader.onload = () => {
    if (workOpen.value && work.id === key && work.courseId === id) work.screenshot = String(reader.result)
  }
  reader.onerror = () => {
    error.value = '截图读取失败。'
  }
  reader.readAsDataURL(file)
}
async function saveWork() {
  if (!work.title.trim() || !(work.location.trim() || work.description.trim() || work.screenshot)) {
    error.value = '请填写作品名称并添加作品链接、说明或截图。'
    return
  }
  if (work.location && !/^(https?:\/\/|\/|[A-Za-z]:\\)/.test(work.location)) {
    error.value = '请输入完整网址或本地绝对路径。'
    return
  }
  const value = { ...work, id: work.id || crypto.randomUUID(), title: work.title.trim(), acceptedAt: null }
  if (
    await learning.mutate((data) => {
      data.works = [...data.works.filter((w) => w.id !== value.id), value]
    })
  )
    workOpen.value = false
  else error.value = learning.state.error
}
async function accept(value: PortfolioWork) {
  if (!course.value || !canAcceptWork(course.value, value.moduleId)) {
    error.value = '完成该阶段验收后即可归档。'
    return
  }
  await learning.mutate((data) => {
    const w = data.works.find((w) => w.id === value.id)
    if (w) w.acceptedAt = Date.now()
  })
}
async function openWork(location: string) {
  try {
    await desktopInvoke('open_learning_resource', { location })
  } catch (e) {
    error.value = String(e)
  }
}
async function exportReport(format: 'md' | 'png') {
  if (!report.value || !course.value) return
  busy.value = true
  error.value = ''
  try {
    await exportStudyDigest(
      report.value.markdown,
      `${course.value.course.name}-${report.value.graduated ? '结课证书' : '学习成果'}`,
      format,
    )
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="space-y-6" aria-label="实践作品与学习契约">
    <header>
      <h2 class="text-heading-sm">我的作品集</h2>
      <p class="mt-2 text-body-sm text-stone">把学到的知识，变成拿得出的作品。</p>
    </header>
    <VSelect v-model="courseId" label="课程" :items="courseOptions" />
    <p v-if="error || learning.state.error" role="alert" class="text-body-sm text-error">
      {{ error || learning.state.error }}
    </p>
    <template v-if="course">
      <div class="flex flex-wrap gap-3">
        <UiButton variant="dark" @click="editWork()">添加作品</UiButton
        ><UiButton @click="openContract">签订学习契约</UiButton>
      </div>
      <article v-for="c in contracts" :key="c.id" class="rounded-3xl border border-linen bg-page-cream p-6">
        <p class="text-caption font-bold text-deep-indigo">
          学习契约 · {{ stages.find((s) => s.value === c.moduleId)?.title }}
        </p>
        <h3 class="mt-3 text-subheading">{{ c.goal }}</h3>
        <p class="mt-3 text-body-sm text-stone">每日 {{ c.minutes }} 分钟 · {{ c.deadline }} 前完成</p>
      </article>
      <div class="grid gap-5 lg:grid-cols-2">
        <article v-for="w in works" :key="w.id" class="pane overflow-hidden">
          <img
            v-if="w.screenshot"
            :src="w.screenshot"
            :alt="`${w.title} 效果截图`"
            class="max-h-64 w-full object-contain bg-page-cream"
          />
          <div class="space-y-3 p-5">
            <p class="text-caption text-deep-indigo">
              {{ w.acceptedAt ? '已验收归档' : '实践中' }} ·
              {{ stages.find((s) => s.value === w.moduleId)?.title ?? '原阶段' }}
            </p>
            <h3 class="break-words text-subheading">{{ w.title }}</h3>
            <p class="whitespace-pre-wrap break-words text-body-sm text-stone">{{ w.description }}</p>
            <UiButton v-if="w.location" size="sm" @click="openWork(w.location)">打开作品</UiButton>
            <div class="flex gap-2">
              <UiButton
                v-if="!w.acceptedAt"
                size="sm"
                variant="dark"
                :disabled="!!learning.state.saving"
                @click="accept(w)"
                >验收归档</UiButton
              ><UiButton size="sm" variant="text" @click="editWork(w)">编辑</UiButton>
            </div>
          </div>
        </article>
      </div>
      <p v-if="!works.length" class="pane p-10 text-center text-body-sm text-stone">从第一个小作品开始。</p>
      <section class="pane p-6">
        <h3 class="text-subheading">{{ report?.graduated ? '结课证书已就绪' : '学习成果报告' }}</h3>
        <div class="mt-4 flex gap-3">
          <UiButton :disabled="busy" @click="exportReport('png')">导出高清图片</UiButton
          ><UiButton :disabled="busy" @click="exportReport('md')">导出报告</UiButton>
        </div>
      </section>
    </template>
    <StudyFormDialog
      v-model:open="contractOpen"
      title="学习契约"
      title-id="learning-contract-title"
      submit-label="签订契约"
      :busy="!!learning.state.saving"
      :error="error"
      @submit="sign"
      ><VSelect v-model="contract.moduleId" label="学习阶段" :items="stages" /><VTextarea
        v-model="contract.goal"
        label="交付目标"
        maxlength="1000"
        rows="3" /><UiDatePicker
        v-model="contract.deadline"
        label="目标完成日期"
        :min="learning.date.value" /><VTextField
        v-model.number="contract.minutes"
        label="每日承诺投入（分钟）"
        type="number"
        min="5"
        max="1440"
    /></StudyFormDialog>
    <StudyFormDialog
      v-model:open="workOpen"
      :title="work.id ? '编辑作品' : '添加作品'"
      title-id="portfolio-work-title"
      submit-label="保存作品"
      :busy="!!learning.state.saving"
      :error="error"
      @submit="saveWork"
      ><VSelect v-model="work.moduleId" label="所属阶段" :items="stages" /><VTextField
        v-model="work.title"
        label="作品名称"
        maxlength="150"
      /><VTextField v-model="work.location" label="在线 Demo / Git 仓库 / 本地路径" /><VTextarea
        v-model="work.description"
        label="作品说明"
        maxlength="6000"
        rows="3"
      /><label class="block text-body-sm"
        >效果截图<input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          class="mt-2 block max-w-full"
          @change="screenshot" /></label
      ><img v-if="work.screenshot" :src="work.screenshot" alt="作品截图预览" class="max-h-52 rounded-2xl" /><UiButton
        v-if="work.screenshot"
        size="sm"
        variant="text"
        @click="work.screenshot = ''"
        >移除截图</UiButton
      ></StudyFormDialog
    >
  </section>
</template>

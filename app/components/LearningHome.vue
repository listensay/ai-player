<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCourseStore } from '~/composables/useCourseStore'
import { useLearningHome } from '~/composables/useLearningHome'
import type { LibraryCourse } from '~/types/course'
import {
  budgetTotal,
  formatMinutes,
  isPaused,
  programDate,
  programDay,
  stageForDay,
  videoFinishDay,
} from '~/utils/studyProgram'
import { formatTime } from '~/utils/time'
import { formatStudyDuration } from '~/utils/guide'
import { calculateDay } from '~/utils/dailyPlan'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'
import WelcomeScreen from '~/components/WelcomeScreen.vue'

const store = useCourseStore(),
  router = useRouter(),
  home = useLearningHome()
const { courses, loading, error, date, availableMinutes, plans, today, week, selected, selectedDate, weekOffset } = home
const filter = ref('active'),
  search = ref(''),
  page = ref(1),
  changing = ref('')
const filtered = computed(() =>
  courses.value
    .filter((entry) => {
      const status =
        entry.course.status === 'active' && isPaused(entry.context?.plan?.program, date.value)
          ? 'paused'
          : entry.course.status
      return (
        (filter.value === 'all' || status === filter.value) &&
        entry.course.name.toLowerCase().includes(search.value.trim().toLowerCase())
      )
    })
    .sort((a, b) => Number(b.course.pinned) - Number(a.course.pinned) || b.course.lastOpenedAt - a.course.lastOpenedAt),
)
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 12)))
const visible = computed(() => filtered.value.slice((page.value - 1) * 12, page.value * 12))
watch([filter, search], () => {
  page.value = 1
})
const resume = computed(
  () =>
    [...courses.value]
      .filter((e) => e.course.status === 'active')
      .sort((a, b) => b.course.lastOpenedAt - a.course.lastOpenedAt)[0],
)
const scheduled = computed(() =>
  plans.value.filter(
    (p) =>
      p.entry.course.status === 'active' &&
      p.entry.context?.plan &&
      (budgetTotal(p.day.budget) > 0 || p.day.today.items.length || p.day.work.length),
  ),
)
const totalBudget = computed(() => plans.value.reduce((n, p) => n + budgetTotal(p.day.budget), 0))
const weekTaskCount = computed(() => week.value.flatMap((day) => day.tasks))
const maxWeek = computed(() => Math.max(3600, ...week.value.map((day) => day.videoSeconds + day.workSeconds)))
const weekSeconds = computed(() => week.value.reduce((n, day) => n + day.videoSeconds + day.workSeconds, 0))
const partial = computed(() => courses.value.some((c) => c.error))
function go(
  course: LibraryCourse,
  view: 'overview' | 'player' | 'today' | 'practice' = 'overview',
  path?: string,
  seconds?: number,
) {
  return router.push({
    path: `/courses/${encodeURIComponent(course.id)}${view === 'player' ? '/player' : ''}`,
    query: {
      ...(view === 'player' ? { autoplay: '1' } : {}),
      ...(view === 'player' && (path ?? course.lastVideoPath) ? { lesson: path ?? course.lastVideoPath } : {}),
      ...(seconds !== undefined ? { at: String(seconds) } : {}),
      ...(view === 'today' || view === 'practice' ? { panel: view } : {}),
    },
  })
}
async function openFolder() {
  if (await store.openFolder()) await go(store.state.library.find((c) => c.id === store.state.course?.id)!)
}
async function update(course: LibraryCourse, patch: Partial<Pick<LibraryCourse, 'status' | 'pinned'>>) {
  changing.value = course.id
  try {
    if (await store.updateLibrary(course.id, patch)) {
      Object.assign(course, patch)
      await home.refresh()
      page.value = Math.min(page.value, pages.value)
    }
  } finally {
    changing.value = ''
  }
}
function finish(entry: (typeof courses.value)[number]) {
  if (!entry.context?.plan?.program || entry.course.status !== 'active') return ''
  const day = calculateDay(entry.context, date.value),
    plan = entry.context.plan
  const end = videoFinishDay(
    plan.program!,
    plan.modules,
    date.value,
    day.schedule.remainingSeconds,
    day.today.items.filter((i) => i.done && i.kind !== 'question').reduce((n, i) => n + i.seconds, 0),
  )
  if (end === null) return '视频已看完，实践与验收单独记录'
  if (end === Infinity) return '当前安排暂无预计观看完成日期'
  return `预计 ${programDate(plan.program!, end)} 看完视频${end > plan.program!.days ? ` · 超出计划 ${end - plan.program!.days} 天` : ''}${day.schedule.unknown ? '（含估算）' : ''}`
}
function done(course: (typeof courses.value)[number]) {
  return Math.min(course.course.videoCount, Object.values(course.context?.progress ?? {}).filter((p) => p.done).length)
}
function stageText(entry: (typeof courses.value)[number]) {
  if (!entry.context?.plan) return ''
  const day = calculateDay(entry.context, date.value),
    plan = entry.context.plan
  const next = day.route.find((lesson) => !entry.context!.progress[lesson.path]?.done)
  const current = plan.modules.find((module) => module.id === next?.moduleId)
  const expected = plan.program ? stageForDay(plan.modules, programDay(plan.program, date.value)) : null
  if (!current) return ''
  return `视频学至：${current.title}${expected && expected.id !== current.id ? ` · 按计划应到：${expected.title}` : ''}`
}
function taskTitle(path: string) {
  return (
    path
      .split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/, '') ?? path
  )
}
</script>

<template>
  <div v-if="loading && !courses.length" class="mx-auto max-w-7xl p-8 text-body-sm text-stone" role="status">
    正在读取学习记录…
  </div>
  <div v-else-if="error && !courses.length" class="pane mx-auto my-10 max-w-lg p-6">
    <p role="alert" class="text-error">{{ error }}</p>
    <UiButton class="mt-4" @click="home.refresh">重试</UiButton>
  </div>
  <WelcomeScreen v-else-if="!courses.length" />
  <div v-else class="mx-auto w-full max-w-[1440px] space-y-6 px-5 py-7 md:px-8 md:py-10">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-caption font-bold text-stone">
          {{ date }} · {{ ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(date).getUTCDay()] }}
        </p>
        <h1 class="mt-2 text-heading">今天的学习</h1>
      </div>
      <div class="flex gap-2">
        <UiButton variant="text" :disabled="loading" @click="home.refresh">刷新</UiButton
        ><UiButton :disabled="store.state.loading" @click="openFolder"
          ><AppIcon name="folder" :size="18" />打开课程</UiButton
        >
      </div>
    </header>
    <p v-if="error || store.state.error" role="alert" class="text-body-sm text-error">
      {{ error || store.state.error }}
    </p>
    <p v-if="partial" role="status" class="text-caption text-error">部分课程读取失败，汇总暂不包含这些课程。</p>
    <div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div class="min-w-0 space-y-6">
        <section v-if="resume" class="rounded-3xl bg-sunbeam-yellow p-6 md:p-7" aria-label="继续学习">
          <div class="flex flex-wrap items-center justify-between gap-5">
            <div class="min-w-0 flex-1">
              <p class="text-caption font-bold">继续学习</p>
              <h2 class="mt-2 break-words text-heading-sm">{{ resume.course.name }}</h2>
              <p v-if="resume.course.lastVideoPath" class="mt-2 break-words text-body-sm">
                {{ taskTitle(resume.course.lastVideoPath) }} ·
                {{ formatTime(resume.context?.progress[resume.course.lastVideoPath]?.time ?? 0, true) }}
              </p>
            </div>
            <UiButton variant="dark" @click="go(resume.course, 'player')"
              ><AppIcon name="play" :size="18" />继续播放</UiButton
            >
          </div>
        </section>
        <section class="pane p-5 md:p-6" aria-label="跨课程今日安排">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-subheading">今日安排</h2>
            <p class="text-caption text-stone">{{ scheduled.length }} 门课程 · 计划 {{ formatMinutes(totalBudget) }}</p>
          </div>
          <p
            v-if="availableMinutes > 0 && totalBudget > availableMinutes"
            class="mt-3 rounded-xl bg-sunbeam-yellow/20 p-3 text-body-sm"
          >
            超出今日可用时间 {{ formatMinutes(totalBudget - availableMinutes) }}，可分别调整课程安排。
          </p>
          <VExpansionPanels v-if="scheduled.length" class="mt-4" multiple>
            <VExpansionPanel v-for="{ entry, day } in scheduled" :key="entry.course.id" :value="entry.course.id">
              <VExpansionPanelTitle
                ><div class="min-w-0">
                  <p class="break-words text-body-sm font-bold">{{ entry.course.name }}</p>
                  <p v-if="budgetTotal(day.budget) === 0" class="mt-1 text-caption text-stone">
                    今日休息 · 保留学习记录
                  </p>
                  <p v-else class="mt-1 text-caption text-stone">
                    {{ day.today.items.filter((i) => i.done).length + day.work.filter((i) => i.done).length }} /
                    {{ day.today.items.length + day.work.length }} 项 · {{ formatMinutes(budgetTotal(day.budget)) }}
                  </p>
                </div></VExpansionPanelTitle
              >
              <VExpansionPanelText>
                <div class="max-h-80 overflow-y-auto">
                  <ul class="divide-y divide-linen">
                    <li v-for="item in day.today.items" :key="item.id" class="flex items-center gap-3 py-3">
                      <AppIcon :name="item.done ? 'check' : 'film'" :size="17" /><button
                        class="min-w-0 flex-1 text-left text-body-sm hover:text-deep-indigo"
                        @click="
                          item.kind === 'question'
                            ? go(entry.course, 'today')
                            : go(entry.course, 'player', item.path, item.start)
                        "
                      >
                        <span :class="item.done ? 'line-through text-stone' : ''">{{
                          item.kind === 'question'
                            ? entry.context?.questions.find((q) => q.id === item.questionId)?.text
                            : taskTitle(item.path)
                        }}</span
                        ><span class="mt-1 block text-caption text-stone"
                          >{{ formatStudyDuration(item.seconds) }}{{ item.estimated ? ' · 估算' : '' }}</span
                        >
                      </button>
                    </li>
                    <li v-for="work in day.work" :key="work.id" class="flex items-center gap-3 py-3">
                      <AppIcon :name="work.done ? 'check' : 'note'" :size="17" /><button
                        class="min-w-0 flex-1 text-left text-body-sm hover:text-deep-indigo"
                        @click="go(entry.course, 'today')"
                      >
                        {{ work.title
                        }}<span class="mt-1 block text-caption text-stone"
                          >已投入 {{ work.minutes }} / {{ work.targetMinutes }} 分钟</span
                        >
                      </button>
                    </li>
                  </ul>
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                  <UiButton size="sm" @click="go(entry.course, 'today')">调整与记录</UiButton
                  ><UiButton
                    v-if="
                      day.today.items.some((i) => i.kind !== 'question') &&
                      day.today.items.filter((i) => i.kind !== 'question').every((i) => i.done)
                    "
                    size="sm"
                    variant="ghost"
                    @click="go(entry.course, 'practice')"
                    >今日巩固</UiButton
                  >
                </div>
              </VExpansionPanelText>
            </VExpansionPanel>
          </VExpansionPanels>
          <p v-else class="py-6 text-body-sm text-stone">今天没有待安排的课程。可继续播放，或在课程中设置学习计划。</p>
        </section>
        <section aria-label="我的课程">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-subheading">我的课程</h2>
            <VSelect
              v-model="filter"
              label="课程状态"
              class="max-w-40"
              :items="[
                { title: '进行中', value: 'active' },
                { title: '已暂停', value: 'paused' },
                { title: '已归档', value: 'archived' },
                { title: '全部课程', value: 'all' },
              ]"
            />
          </div>
          <VTextField
            v-model="search"
            label="搜索课程"
            clearable
            class="mt-4"
            @update:model-value="search = $event ?? ''"
            ><template #prepend-inner><AppIcon name="search" :size="18" /></template
          ></VTextField>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <article v-for="entry in visible" :key="entry.course.id" class="pane flex min-w-0 flex-col p-5">
              <div class="flex items-start justify-between gap-3">
                <button
                  class="min-w-0 break-words text-left text-body font-bold hover:text-deep-indigo"
                  @click="go(entry.course)"
                >
                  {{ entry.course.name }}</button
                ><VMenu
                  ><template #activator="{ props }"
                    ><UiButton
                      v-bind="props"
                      icon
                      variant="text"
                      size="sm"
                      :title="`${entry.course.name}的课程操作`"
                      :disabled="changing === entry.course.id"
                      ><AppIcon name="menu" :size="17" /></UiButton></template
                  ><VList
                    ><VListItem
                      :title="entry.course.pinned ? '取消置顶' : '置顶课程'"
                      @click="update(entry.course, { pinned: !entry.course.pinned })" /><VListItem
                      v-if="entry.course.status === 'active'"
                      title="暂停课程"
                      @click="update(entry.course, { status: 'paused' })" /><VListItem
                      v-else
                      title="恢复课程"
                      @click="update(entry.course, { status: 'active' })" /><VListItem
                      v-if="entry.course.status !== 'archived'"
                      title="归档课程"
                      @click="update(entry.course, { status: 'archived' })" /></VList
                ></VMenu>
              </div>
              <p class="mt-2 text-caption text-stone">
                {{ entry.course.pinned ? '已置顶 · ' : ''
                }}{{
                  entry.course.status === 'archived'
                    ? '已归档'
                    : entry.course.status === 'paused' || isPaused(entry.context?.plan?.program, date)
                      ? '已暂停'
                      : '进行中'
                }}
              </p>
              <p v-if="entry.error" role="alert" class="mt-3 text-caption text-error">{{ entry.error }}</p>
              <template v-else
                ><p class="mt-4 text-body-sm">观看完成 {{ done(entry) }} / {{ entry.course.videoCount }} 节</p>
                <div
                  class="mt-2 h-1.5 overflow-hidden rounded-full bg-linen"
                  role="progressbar"
                  :aria-label="`${entry.course.name}观看进度`"
                  :aria-valuenow="done(entry)"
                  :aria-valuemin="0"
                  :aria-valuemax="entry.course.videoCount"
                >
                  <div
                    class="h-full rounded-full bg-deep-indigo"
                    :style="{
                      width: `${entry.course.videoCount ? (done(entry) / entry.course.videoCount) * 100 : 0}%`,
                    }"
                  />
                </div>
                <p v-if="stageText(entry)" class="mt-3 text-caption text-graphite">{{ stageText(entry) }}</p>
                <p v-if="finish(entry)" class="mt-3 text-caption leading-relaxed text-stone">
                  {{ finish(entry) }}
                </p></template
              >
              <div class="mt-4 flex flex-wrap gap-2">
                <UiButton size="sm" variant="ghost" @click="go(entry.course)">查看课程</UiButton
                ><UiButton
                  v-if="entry.course.status === 'active'"
                  size="sm"
                  variant="text"
                  @click="go(entry.course, 'today')"
                  >{{ isPaused(entry.context?.plan?.program, date) ? '恢复计划' : '安排学习' }}</UiButton
                >
              </div>
            </article>
          </div>
          <p v-if="!visible.length" class="py-8 text-center text-body-sm text-stone">暂无符合条件的课程。</p>
          <div v-if="pages > 1" class="mt-4 flex items-center justify-end gap-3">
            <UiButton size="sm" :disabled="page <= 1" @click="page--">上一页</UiButton
            ><span class="text-caption">{{ page }} / {{ pages }}</span
            ><UiButton size="sm" :disabled="page >= pages" @click="page++">下一页</UiButton>
          </div>
        </section>
      </div>
      <aside class="min-w-0 space-y-6">
        <section class="pane p-5" aria-label="今日投入">
          <h2 class="text-body font-bold">今日投入</h2>
          <p class="mt-3 text-heading">
            {{ formatMinutes(Math.floor((today.videoSeconds + today.workSeconds) / 60)) }}
          </p>
          <p class="mt-2 text-caption text-stone">
            观看 {{ formatMinutes(Math.floor(today.videoSeconds / 60)) }} · 实践
            {{ formatMinutes(Math.floor(today.workSeconds / 60)) }}
          </p>
          <VTextField
            v-model.number="availableMinutes"
            class="mt-5"
            type="number"
            min="0"
            max="1440"
            label="每日可用时间（分钟）"
            @change="home.saveAvailable(availableMinutes)"
          />
          <p class="mt-2 text-caption text-stone">设为 0 时不比较总预算。</p>
        </section>
        <section class="pane p-5" aria-label="每周学习回顾">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-body font-bold">{{ weekOffset === 0 ? '本周回顾' : '每周回顾' }}</h2>
            <div class="flex gap-1">
              <UiButton icon size="sm" variant="text" title="上一周" @click="home.moveWeek(-1)"
                ><AppIcon name="arrow-left" :size="16" /></UiButton
              ><UiButton
                icon
                size="sm"
                variant="text"
                title="下一周"
                :disabled="weekOffset >= 0"
                @click="home.moveWeek(1)"
                ><AppIcon name="chevron-right" :size="16"
              /></UiButton>
            </div>
          </div>
          <p class="mt-2 text-caption text-stone">{{ week[0]?.date }} — {{ week[6]?.date }}</p>
          <p class="mt-3 text-subheading">{{ formatMinutes(Math.floor(weekSeconds / 60)) }}</p>
          <p v-if="weekTaskCount.length" class="mt-2 text-caption text-stone">
            已记录任务 {{ weekTaskCount.filter((task) => task.done).length }} / {{ weekTaskCount.length }}
          </p>
          <div class="mt-5 grid grid-cols-7 gap-2" aria-label="每日实际投入">
            <button
              v-for="day in week"
              :key="day.date"
              class="min-w-0 rounded-lg px-1 py-2 text-center hover:bg-page-cream"
              :class="selectedDate === day.date ? 'bg-page-cream ring-1 ring-deep-indigo' : ''"
              :aria-label="`${day.date}，投入${Math.floor((day.videoSeconds + day.workSeconds) / 60)}分钟`"
              :aria-pressed="selectedDate === day.date"
              @click="selectedDate = day.date"
            >
              <span class="flex h-20 items-end justify-center"
                ><span
                  class="w-4 rounded-t-md bg-deep-indigo"
                  :style="{
                    height: `${Math.max(2, ((day.videoSeconds + day.workSeconds) / maxWeek) * 100)}%`,
                    opacity: day.videoSeconds + day.workSeconds ? 1 : 0.15,
                  }" /></span
              ><span class="mt-2 block text-caption">{{ day.date.slice(8) }}</span>
            </button>
          </div>
          <div class="mt-5 border-t border-linen pt-4">
            <p class="text-body-sm font-bold">
              {{ selectedDate }} · {{ formatMinutes(Math.floor((selected.videoSeconds + selected.workSeconds) / 60)) }}
            </p>
            <p v-if="selected.plannedMinutes !== null" class="mt-2 text-caption text-stone">
              已记录计划 {{ formatMinutes(selected.plannedMinutes) }} · 任务
              {{ selected.tasks.filter((t) => t.done).length }} / {{ selected.tasks.length }}
            </p>
            <p v-if="selected.missingPlan || selected.plannedMinutes === null" class="mt-2 text-caption text-stone">
              {{ selectedDate > date ? '尚未产生学习记录。' : '未保存完整历史计划，仅统计已有记录。' }}
            </p>
            <VExpansionPanels v-if="selected.details.length" class="mt-3"
              ><VExpansionPanel v-for="detail in selected.details" :key="detail.id" :value="detail.id"
                ><VExpansionPanelTitle
                  ><div>
                    <p class="text-caption font-bold">{{ detail.name }}</p>
                    <p class="mt-1 text-caption text-stone">
                      {{ formatMinutes(Math.floor((detail.videoSeconds + detail.workSeconds) / 60)) }}
                    </p>
                  </div></VExpansionPanelTitle
                ><VExpansionPanelText
                  ><p class="text-caption text-stone">
                    观看 {{ formatMinutes(Math.floor(detail.videoSeconds / 60)) }} · 实践
                    {{ formatMinutes(Math.floor(detail.workSeconds / 60)) }}
                  </p>
                  <ul v-if="detail.snapshot?.tasks.length" class="mt-3 max-h-60 space-y-2 overflow-y-auto">
                    <li v-for="task in detail.snapshot.tasks" :key="task.id" class="flex gap-2 text-caption">
                      <AppIcon :name="task.done ? 'check' : 'clock'" :size="14" /><span class="break-words">{{
                        task.title
                      }}</span>
                    </li>
                  </ul></VExpansionPanelText
                ></VExpansionPanel
              ></VExpansionPanels
            >
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

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
import { calculateDay } from '~/utils/dailyPlan'
import { dailyPlanComplete } from '~/utils/knowledge'
import UiButton from '~/components/UiButton.vue'
import AppIcon from '~/components/AppIcon.vue'
import WelcomeScreen from '~/components/WelcomeScreen.vue'
import { useLearningManagement } from '~/composables/useLearningManagement'
import { useAppDialogs } from '~/composables/useAppDialogs'

const learning = useLearningManagement(),
  dialogs = useAppDialogs()
const weakCount = computed(() => learning.state.data.cards.filter((card) => card.weak).length)

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
      const matchesStatus = filter.value === 'all' || status === filter.value
      const matchesSearch =
        !search.value.trim() || entry.course.name.toLowerCase().includes(search.value.trim().toLowerCase())
      return matchesStatus && matchesSearch
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
  <div v-if="loading && !courses.length" class="w-full p-8 text-body-sm text-stone" role="status">
    正在读取学习记录…
  </div>
  <div v-else-if="error && !courses.length" class="pane mx-auto my-10 max-w-lg p-6">
    <p role="alert" class="text-error">{{ error }}</p>
    <UiButton class="mt-4" @click="home.refresh">重试</UiButton>
  </div>
  <WelcomeScreen v-else-if="!courses.length" />
  <div v-else class="mx-auto w-full max-w-[1240px] space-y-7 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center gap-1.5 rounded-full bg-page-cream px-3 py-1 text-caption font-bold text-charcoal-ink"
          >
            <span class="h-2 w-2 rounded-full bg-brand-orange" aria-hidden="true" />
            {{ date }} · {{ ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(date).getUTCDay()] }}
          </span>
        </div>
        <h1 class="mt-2 text-heading font-bold tracking-tight text-charcoal-ink">网课学习</h1>
      </div>
      <div class="flex items-center gap-2.5">
        <UiButton
          variant="ghost"
          size="sm"
          class="border border-linen hover:border-charcoal-ink/30"
          :disabled="loading"
          @click="home.refresh"
        >
          <AppIcon name="reset" :size="16" :class="{ 'animate-spin': loading }" />
          <span>刷新</span>
        </UiButton>
        <UiButton
          variant="dark"
          size="sm"
          class="rounded-full px-4 shadow-subtle"
          :disabled="store.state.loading"
          @click="openFolder"
        >
          <AppIcon name="folder" :size="16" />
          <span>打开课程</span>
        </UiButton>
      </div>
    </header>

    <p v-if="error || store.state.error" role="alert" class="text-body-sm text-error">
      {{ error || store.state.error }}
    </p>
    <p v-if="partial" role="status" class="text-caption text-error">部分课程读取失败。</p>

    <section
      v-if="learning.state.ready && weakCount > 0"
      class="pane flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-linen bg-gradient-to-r from-pure-white to-page-cream p-5"
      aria-label="错题与薄弱项"
    >
      <div class="flex items-center gap-3.5">
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sunbeam-yellow/40 text-charcoal-ink"
        >
          <AppIcon name="sparkles" :size="20" class="text-charcoal-ink" />
        </span>
        <div>
          <h2 class="text-body font-bold text-charcoal-ink">待加强 · {{ weakCount }} 项</h2>
          <p class="mt-0.5 text-caption text-stone">回看知识点，针对薄弱项补练巩固。</p>
        </div>
      </div>
      <UiButton size="sm" variant="ghost" class="border border-linen" @click="dialogs.open('study', 'review')">
        查看错题与薄弱项
      </UiButton>
    </section>

    <div class="grid items-start gap-6 lg:gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div class="min-w-0 space-y-6">
        <section
          v-if="resume"
          class="pane rounded-3xl border border-sunbeam-yellow/40 bg-gradient-to-br from-sunbeam-yellow/25 via-sunbeam-yellow/15 to-pure-white p-6 shadow-xs sm:p-7"
          aria-label="继续学习"
        >
          <div class="flex flex-wrap items-center justify-between gap-5">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="rounded-full bg-sunbeam-yellow px-2.5 py-0.5 text-caption font-bold text-charcoal-ink">
                  继续上次学习
                </span>
              </div>
              <h2 class="mt-2.5 text-heading-sm font-bold text-charcoal-ink [overflow-wrap:anywhere]">
                {{ resume.course.name }}
              </h2>
              <p
                v-if="resume.course.lastVideoPath"
                class="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-graphite"
              >
                <AppIcon name="film" :size="16" class="text-stone" />
                <span class="font-medium [overflow-wrap:anywhere]">{{ taskTitle(resume.course.lastVideoPath) }}</span>
                <span
                  class="tabular rounded-md border border-linen bg-pure-white/80 px-2 py-0.5 text-caption font-bold text-charcoal-ink"
                >
                  上次播放至 {{ formatTime(resume.context?.progress[resume.course.lastVideoPath]?.time ?? 0, true) }}
                </span>
              </p>
            </div>
            <UiButton
              variant="dark"
              size="lg"
              class="rounded-full px-6 shadow-subtle"
              @click="go(resume.course, 'player')"
            >
              <AppIcon name="play" :size="18" />
              继续播放
            </UiButton>
          </div>
        </section>

        <section class="pane rounded-3xl p-6 sm:p-7" aria-label="跨课程今日安排">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-linen/70 pb-4">
            <div class="flex items-center gap-2.5">
              <h2 class="text-heading-sm font-bold text-charcoal-ink">今日安排</h2>
              <span class="rounded-full bg-page-cream px-2.5 py-0.5 text-caption font-bold text-stone">
                {{ scheduled.length }} 门课程
              </span>
            </div>
            <p class="text-caption font-bold text-stone">计划 {{ formatMinutes(totalBudget) }}</p>
          </div>

          <div
            v-if="availableMinutes > 0 && totalBudget > availableMinutes"
            class="mt-4 flex items-center gap-2.5 rounded-2xl border border-sunbeam-yellow/40 bg-sunbeam-yellow/20 p-3.5 text-body-sm text-charcoal-ink"
          >
            <AppIcon name="clock" :size="18" class="shrink-0 text-charcoal-ink" />
            <span>超出今日可用时间 {{ formatMinutes(totalBudget - availableMinutes) }}，可分别调整课程安排。</span>
          </div>

          <VExpansionPanels v-if="scheduled.length" class="course-panels mt-4" multiple>
            <VExpansionPanel v-for="{ entry, day } in scheduled" :key="entry.course.id" :value="entry.course.id">
              <VExpansionPanelTitle>
                <div class="min-w-0 flex-1 pr-3">
                  <p class="text-body font-bold text-charcoal-ink [overflow-wrap:anywhere]">{{ entry.course.name }}</p>
                  <p v-if="budgetTotal(day.budget) === 0" class="mt-1 text-caption text-stone">
                    今日休息 · 保留学习记录
                  </p>
                  <p v-else class="mt-1 text-caption text-stone">
                    计划投入 {{ formatMinutes(budgetTotal(day.budget)) }}
                  </p>
                </div>
              </VExpansionPanelTitle>
              <VExpansionPanelText>
                <ul v-if="day.today.items.length" class="space-y-2" aria-label="待看课节">
                  <li
                    v-for="item in day.today.items"
                    :key="item.path"
                    class="flex items-center justify-between gap-3 rounded-xl border border-linen/60 bg-page-cream/30 p-3 text-body-sm"
                  >
                    <div class="flex min-w-0 items-center gap-2.5">
                      <span
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                        :class="item.done ? 'bg-charcoal-ink text-pure-white' : 'bg-page-cream text-stone'"
                      >
                        <AppIcon :name="item.done ? 'check' : 'film'" :size="15" />
                      </span>
                      <span class="truncate font-medium text-charcoal-ink">{{ taskTitle(item.path) }}</span>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <span class="tabular text-caption text-stone">
                        {{ formatMinutes(Math.floor(item.seconds / 60)) }}
                      </span>
                      <UiButton
                        size="sm"
                        variant="ghost"
                        class="h-7 rounded-full border border-linen px-2.5 text-caption hover:border-charcoal-ink/30"
                        @click="go(entry.course, 'player', item.path)"
                      >
                        播放
                      </UiButton>
                    </div>
                  </li>
                </ul>
                <ul v-if="day.work.length" class="mt-3 space-y-2" aria-label="巩固任务">
                  <li
                    v-for="work in day.work"
                    :key="work.id"
                    class="flex items-center justify-between gap-3 rounded-xl border border-linen/60 bg-page-cream/30 p-3 text-body-sm"
                  >
                    <div class="flex min-w-0 items-center gap-2.5">
                      <span
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                        :class="work.done ? 'bg-charcoal-ink text-pure-white' : 'bg-page-cream text-stone'"
                      >
                        <AppIcon :name="work.done ? 'check' : 'note'" :size="15" />
                      </span>
                      <span class="truncate font-medium text-charcoal-ink">{{ work.title }}</span>
                    </div>
                  </li>
                </ul>
                <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-linen/50 pt-3">
                  <UiButton size="sm" variant="ghost" class="border border-linen" @click="go(entry.course, 'today')">
                    调整与记录
                  </UiButton>
                  <UiButton
                    v-if="dailyPlanComplete(day.today, date)"
                    size="sm"
                    variant="dark"
                    class="rounded-full"
                    @click="go(entry.course, 'practice')"
                  >
                    今日巩固
                  </UiButton>
                </div>
              </VExpansionPanelText>
            </VExpansionPanel>
          </VExpansionPanels>
          <p v-else class="py-8 text-center text-body-sm text-stone">
            今天没有待安排的课程。可继续播放，或在课程中设置学习计划。
          </p>
        </section>

        <section aria-label="我的课程">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-2.5">
              <h2 class="text-heading-sm font-bold text-charcoal-ink">我的课程</h2>
              <span class="rounded-full bg-page-cream px-2.5 py-0.5 text-caption font-bold text-stone">
                {{ filtered.length }}
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-2.5">
              <div class="relative w-44 sm:w-52">
                <input
                  v-model="search"
                  type="text"
                  placeholder="搜索课程..."
                  class="w-full rounded-full border border-linen bg-pure-white py-1.5 pl-8 pr-3 text-caption text-charcoal-ink placeholder-stone/60 outline-none transition-colors focus:border-charcoal-ink"
                />
                <AppIcon
                  name="search"
                  :size="14"
                  class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone"
                />
              </div>
              <div
                class="flex items-center gap-1 rounded-full bg-page-cream p-1"
                role="radiogroup"
                aria-label="课程状态"
              >
                <button
                  v-for="item in [
                    { title: '进行中', value: 'active' },
                    { title: '已暂停', value: 'paused' },
                    { title: '已归档', value: 'archived' },
                    { title: '全部', value: 'all' },
                  ]"
                  :key="item.value"
                  type="button"
                  role="radio"
                  :aria-checked="filter === item.value"
                  class="rounded-full px-3 py-1 text-caption font-bold transition-colors"
                  :class="
                    filter === item.value
                      ? 'bg-charcoal-ink text-pure-white shadow-xs'
                      : 'text-stone hover:text-charcoal-ink'
                  "
                  @click="filter = item.value"
                >
                  {{ item.title }}
                </button>
              </div>
            </div>
          </div>

          <div class="mt-5 grid gap-5 sm:grid-cols-2">
            <article
              v-for="entry in visible"
              :key="entry.course.id"
              class="pane flex min-w-0 flex-col justify-between rounded-3xl p-6 transition-all duration-150 hover:border-charcoal-ink/50 hover:shadow-subtle"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-3">
                  <button
                    class="line-clamp-2 min-w-0 break-words text-left text-body-lg font-bold text-charcoal-ink transition-colors hover:text-deep-indigo"
                    @click="go(entry.course)"
                  >
                    {{ entry.course.name }}
                  </button>
                  <VMenu>
                    <template #activator="{ props }">
                      <UiButton
                        v-bind="props"
                        icon
                        variant="ghost"
                        size="sm"
                        class="-mr-1 -mt-1 shrink-0"
                        :title="`${entry.course.name}的课程操作`"
                        :disabled="changing === entry.course.id"
                      >
                        <AppIcon name="menu" :size="16" />
                      </UiButton>
                    </template>
                    <VList>
                      <VListItem
                        :title="entry.course.pinned ? '取消置顶' : '置顶课程'"
                        @click="update(entry.course, { pinned: !entry.course.pinned })"
                      />
                      <VListItem
                        v-if="entry.course.status === 'active'"
                        title="暂停课程"
                        @click="update(entry.course, { status: 'paused' })"
                      />
                      <VListItem v-else title="恢复课程" @click="update(entry.course, { status: 'active' })" />
                      <VListItem
                        v-if="entry.course.status !== 'archived'"
                        title="归档课程"
                        @click="update(entry.course, { status: 'archived' })"
                      />
                    </VList>
                  </VMenu>
                </div>

                <div class="mt-2.5 flex flex-wrap items-center gap-2">
                  <span
                    v-if="entry.course.pinned"
                    class="rounded-full bg-sunbeam-yellow/40 px-2.5 py-0.5 text-[11px] font-bold text-charcoal-ink"
                  >
                    已置顶
                  </span>
                  <span
                    class="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                    :class="
                      entry.course.status === 'archived'
                        ? 'bg-page-cream text-stone'
                        : entry.course.status === 'paused' || isPaused(entry.context?.plan?.program, date)
                          ? 'bg-page-cream text-stone'
                          : 'bg-deep-indigo/10 text-deep-indigo font-bold'
                    "
                  >
                    {{
                      entry.course.status === 'archived'
                        ? '已归档'
                        : entry.course.status === 'paused' || isPaused(entry.context?.plan?.program, date)
                          ? '已暂停'
                          : '进行中'
                    }}
                  </span>
                </div>

                <p v-if="entry.error" role="alert" class="mt-4 text-caption text-error">{{ entry.error }}</p>
                <template v-else>
                  <div class="mt-5">
                    <div class="flex items-center justify-between text-caption text-stone">
                      <span>观看完成 {{ done(entry) }} / {{ entry.course.videoCount }} 节</span>
                      <span class="tabular font-bold text-charcoal-ink">
                        {{ entry.course.videoCount ? Math.round((done(entry) / entry.course.videoCount) * 100) : 0 }}%
                      </span>
                    </div>
                    <div
                      class="mt-2 h-2 overflow-hidden rounded-full bg-linen"
                      role="progressbar"
                      :aria-label="`${entry.course.name}观看进度`"
                      :aria-valuenow="done(entry)"
                      :aria-valuemin="0"
                      :aria-valuemax="entry.course.videoCount"
                    >
                      <div
                        class="h-full rounded-full bg-deep-indigo transition-all duration-300"
                        :style="{
                          width: `${entry.course.videoCount ? (done(entry) / entry.course.videoCount) * 100 : 0}%`,
                        }"
                      />
                    </div>
                  </div>
                  <div v-if="stageText(entry) || finish(entry)" class="mt-3.5 space-y-1">
                    <p v-if="stageText(entry)" class="text-caption text-graphite line-clamp-1">
                      {{ stageText(entry) }}
                    </p>
                    <p v-if="finish(entry)" class="text-caption text-stone line-clamp-1">
                      {{ finish(entry) }}
                    </p>
                  </div>
                </template>
              </div>

              <div class="mt-6 flex items-center justify-between gap-3 border-t border-linen/70 pt-4">
                <UiButton
                  size="sm"
                  variant="ghost"
                  class="rounded-full border border-linen px-4 hover:border-charcoal-ink/30"
                  @click="go(entry.course)"
                >
                  查看课程
                </UiButton>
                <UiButton
                  v-if="entry.course.status === 'active'"
                  size="sm"
                  variant="text"
                  class="text-deep-indigo font-bold hover:underline"
                  @click="go(entry.course, 'today')"
                >
                  {{ isPaused(entry.context?.plan?.program, date) ? '恢复计划' : '安排学习' }}
                </UiButton>
              </div>
            </article>
          </div>
          <p v-if="!visible.length" class="py-12 text-center text-body-sm text-stone">暂无符合条件的课程。</p>
          <div v-if="pages > 1" class="mt-5 flex items-center justify-end gap-3">
            <UiButton size="sm" :disabled="page <= 1" @click="page--">上一页</UiButton>
            <span class="tabular text-caption font-medium text-stone">{{ page }} / {{ pages }}</span>
            <UiButton size="sm" :disabled="page >= pages" @click="page++">下一页</UiButton>
          </div>
        </section>
      </div>

      <aside class="min-w-0 space-y-6">
        <section class="pane rounded-3xl p-6" aria-label="今日投入">
          <h2 class="text-body font-bold text-charcoal-ink">今日投入</h2>
          <p class="mt-3 text-heading font-bold text-charcoal-ink">
            {{ formatMinutes(Math.floor((today.videoSeconds + today.workSeconds) / 60)) }}
          </p>
          <p class="mt-1 text-caption text-stone">
            观看 {{ formatMinutes(Math.floor(today.videoSeconds / 60)) }} · 实践
            {{ formatMinutes(Math.floor(today.workSeconds / 60)) }}
          </p>
          <div class="mt-4 border-t border-linen/70 pt-4">
            <VTextField
              v-model.number="availableMinutes"
              density="compact"
              type="number"
              min="0"
              max="1440"
              label="每日可用时间（分钟）"
              hide-details
              @change="home.saveAvailable(availableMinutes)"
            />
            <p class="mt-1.5 text-caption text-stone">设为 0 时不比较总预算。</p>
          </div>
        </section>

        <section class="pane rounded-3xl p-6" aria-label="每周学习回顾">
          <div class="flex items-center justify-between gap-2 border-b border-linen/70 pb-3">
            <h2 class="text-body font-bold text-charcoal-ink">{{ weekOffset === 0 ? '本周回顾' : '每周回顾' }}</h2>
            <div class="flex items-center gap-1">
              <UiButton icon size="sm" variant="ghost" title="上一周" @click="home.moveWeek(-1)">
                <AppIcon name="arrow-left" :size="15" />
              </UiButton>
              <UiButton
                icon
                size="sm"
                variant="ghost"
                title="下一周"
                :disabled="weekOffset >= 0"
                @click="home.moveWeek(1)"
              >
                <AppIcon name="chevron-right" :size="15" />
              </UiButton>
            </div>
          </div>
          <p class="mt-3 text-caption text-stone">{{ week[0]?.date }} — {{ week[6]?.date }}</p>
          <p class="mt-1 text-heading-sm font-bold text-charcoal-ink">
            {{ formatMinutes(Math.floor(weekSeconds / 60)) }}
          </p>
          <p v-if="weekTaskCount.length" class="mt-1 text-caption text-stone">
            已完成任务 {{ weekTaskCount.filter((task) => task.done).length }} / {{ weekTaskCount.length }}
          </p>
          <div class="mt-5 grid grid-cols-7 gap-1.5" aria-label="每日实际投入">
            <button
              v-for="day in week"
              :key="day.date"
              class="min-w-0 rounded-xl px-1 py-2 text-center transition-colors hover:bg-page-cream"
              :class="selectedDate === day.date ? 'bg-page-cream ring-1 ring-deep-indigo' : ''"
              :aria-label="`${day.date}，投入${Math.floor((day.videoSeconds + day.workSeconds) / 60)}分钟`"
              :aria-pressed="selectedDate === day.date"
              @click="selectedDate = day.date"
            >
              <span class="flex h-20 items-end justify-center rounded-lg bg-page-cream/60 p-1">
                <span
                  class="w-3.5 rounded-t-sm bg-deep-indigo transition-all duration-200"
                  :style="{
                    height: `${Math.max(4, ((day.videoSeconds + day.workSeconds) / maxWeek) * 100)}%`,
                    opacity: day.videoSeconds + day.workSeconds ? 1 : 0.2,
                  }"
                />
              </span>
              <span class="mt-2 block text-[11px] font-medium text-stone tabular">{{ day.date.slice(8) }}</span>
            </button>
          </div>
          <div class="mt-5 border-t border-linen/70 pt-4">
            <p class="text-body-sm font-bold text-charcoal-ink">
              {{ selectedDate }} · {{ formatMinutes(Math.floor((selected.videoSeconds + selected.workSeconds) / 60)) }}
            </p>
            <p v-if="selected.plannedMinutes !== null" class="mt-1 text-caption text-stone">
              已记录计划 {{ formatMinutes(selected.plannedMinutes) }} · 任务
              {{ selected.tasks.filter((t) => t.done).length }} / {{ selected.tasks.length }}
            </p>
            <p v-if="selectedDate > date" class="mt-1 text-caption text-stone">尚未产生学习记录。</p>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

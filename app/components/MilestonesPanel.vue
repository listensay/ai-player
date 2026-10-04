<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMilestones } from '~/composables/useMilestones'
import { MILESTONE_CATEGORIES } from '~/utils/milestones'
import AppIcon from '~/components/AppIcon.vue'
import UiButton from '~/components/UiButton.vue'

const milestones = useMilestones()
const filter = ref<'all' | 'unlocked' | 'locked'>('all')
const categories = computed(() =>
  MILESTONE_CATEGORIES.map((category) => ({
    ...category,
    badges: milestones.state.badges.filter(
      (badge) =>
        badge.category === category.id && (filter.value === 'all' || badge.unlocked === (filter.value === 'unlocked')),
    ),
  })).filter((category) => category.badges.length),
)
const progress = (value: number) => (Number.isInteger(value) ? value.toLocaleString('zh-CN') : value.toFixed(1))
</script>

<template>
  <section class="scroll-soft min-h-0 flex-1 overflow-y-auto bg-page-cream">
    <div class="mx-auto max-w-6xl space-y-8 px-5 py-8 md:px-8">
      <!-- 顶部总览卡片 -->
      <header class="pane relative overflow-hidden rounded-3xl p-6 md:p-8">
        <div class="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div class="relative z-10 max-w-xl">
            <p class="text-caption font-bold tracking-widest text-deep-indigo uppercase">PLAYBO · 成就勋章</p>
            <h2 class="mt-2 text-heading text-charcoal-ink">里程碑勋章</h2>
            <div class="mt-4 flex items-baseline gap-3">
              <span class="text-display font-bold tabular-nums text-charcoal-ink">{{ milestones.unlocked.value }}</span>
              <span class="text-subheading text-stone">/ 30 已解锁</span>
            </div>
            <!-- 解锁进度条 -->
            <div class="mt-4 w-full max-w-md">
              <div class="mb-1.5 flex items-center justify-between text-caption text-stone">
                <span>解锁进度</span>
                <span class="tabular-nums font-bold text-charcoal-ink">
                  {{ Math.round((milestones.unlocked.value / 30) * 100) }}%
                </span>
              </div>
              <div
                class="h-2 w-full overflow-hidden rounded-pill bg-linen"
                role="progressbar"
                :aria-valuenow="milestones.unlocked.value"
                aria-valuemin="0"
                aria-valuemax="30"
              >
                <div
                  class="h-full rounded-pill bg-deep-indigo transition-all duration-300"
                  :style="{ width: `${(milestones.unlocked.value / 30) * 100}%` }"
                />
              </div>
            </div>
          </div>
          <div
            class="hidden h-24 w-24 shrink-0 items-center justify-center rounded-3xl border border-sunbeam-yellow/40 bg-sunbeam-yellow/20 text-charcoal-ink sm:flex md:h-28 md:w-28"
            aria-hidden="true"
          >
            <AppIcon name="trophy" :size="52" class="text-charcoal-ink" />
          </div>
        </div>
      </header>

      <!-- 筛选与操作栏 -->
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="filter-pills flex items-center gap-2" role="radiogroup" aria-label="勋章筛选">
          <button
            type="button"
            role="radio"
            :aria-checked="filter === 'all'"
            class="filter-pill"
            :class="{ 'filter-pill--active': filter === 'all' }"
            @click="filter = 'all'"
          >
            全部勋章
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="filter === 'unlocked'"
            class="filter-pill"
            :class="{ 'filter-pill--active': filter === 'unlocked' }"
            @click="filter = 'unlocked'"
          >
            已解锁
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="filter === 'locked'"
            class="filter-pill"
            :class="{ 'filter-pill--active': filter === 'locked' }"
            @click="filter = 'locked'"
          >
            待解锁
          </button>
        </div>
        <UiButton size="sm" variant="ghost" :disabled="milestones.state.loading" @click="milestones.refresh()">
          <AppIcon name="reset" :size="14" />
          {{ milestones.state.loading ? '同步中…' : '同步进度' }}
        </UiButton>
      </div>

      <!-- 错误提示 -->
      <div v-if="milestones.state.error" class="pane border-error p-5" role="alert">
        <p class="text-body-sm text-error">{{ milestones.state.error }}</p>
      </div>

      <!-- 加载提示 -->
      <p v-if="!milestones.state.ready && milestones.state.loading" role="status" class="py-10 text-center text-stone">
        正在整理你的成长足迹…
      </p>

      <!-- 勋章分类展示 -->
      <template v-if="milestones.state.ready">
        <section v-for="category in categories" :key="category.id" :aria-labelledby="'medal-' + category.id">
          <div class="mb-4 flex items-center gap-3">
            <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-deep-indigo/10 text-deep-indigo">
              <AppIcon :name="category.icon" :size="18" />
            </div>
            <h2 :id="'medal-' + category.id" class="text-heading-sm text-charcoal-ink">{{ category.name }}</h2>
            <span class="rounded-pill bg-linen/50 px-2.5 py-0.5 text-caption font-bold text-stone">
              {{ milestones.state.badges.filter((badge) => badge.category === category.id && badge.unlocked).length }} /
              5
            </span>
          </div>

          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <article
              v-for="badge in category.badges"
              :key="badge.id"
              class="medal-card relative flex flex-col rounded-2xl border bg-pure-white p-5 transition-all duration-200"
              :class="badge.unlocked ? 'medal-card-earned' : 'border-linen opacity-90 hover:opacity-100'"
            >
              <div
                class="medal-emblem mx-auto"
                :class="badge.unlocked ? 'medal-emblem-earned' : 'medal-emblem-locked'"
                aria-hidden="true"
              >
                <AppIcon :name="category.icon" :size="30" />
                <span class="medal-tier">{{ ['I', 'II', 'III', 'IV', 'V'][badge.tier - 1] }}</span>
              </div>
              <p class="mt-4 flex items-center justify-center">
                <span
                  class="inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-caption font-bold"
                  :class="badge.unlocked ? 'bg-sunbeam-yellow/20 text-charcoal-ink' : 'bg-linen/60 text-stone'"
                >
                  <AppIcon :name="badge.unlocked ? 'check' : 'lock'" :size="12" />
                  {{ badge.unlocked ? '已解锁' : '待解锁' }}
                </span>
              </p>
              <h3 class="mt-2.5 text-center text-body font-bold text-charcoal-ink">{{ badge.name }}</h3>
              <p class="mt-1 flex-1 text-center text-caption leading-relaxed text-stone">{{ badge.description }}</p>
              <progress
                class="medal-progress mt-4 h-1.5 w-full"
                :aria-label="badge.name + '进度'"
                :value="badge.unlocked ? badge.target : Math.min(badge.value, badge.target)"
                :max="badge.target"
              />
              <p class="mt-1.5 text-center text-caption tabular-nums text-stone">
                {{
                  badge.unlocked
                    ? '已达成 · ' + badge.target.toLocaleString('zh-CN') + ' ' + badge.unit
                    : progress(Math.min(badge.value, badge.target)) +
                      ' / ' +
                      badge.target.toLocaleString('zh-CN') +
                      ' ' +
                      badge.unit
                }}
              </p>
            </article>
          </div>
        </section>

        <!-- 空状态 -->
        <div v-if="!categories.length" class="pane p-12 text-center text-stone">
          <div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-linen/50 text-stone">
            <AppIcon name="trophy" :size="28" />
          </div>
          <p class="text-body font-medium text-graphite">
            {{ filter === 'unlocked' ? '暂无已解锁勋章。' : '已解锁全部勋章。' }}
          </p>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.filter-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 18px;
  border-radius: var(--radius-pill);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.01em;
  transition: all 0.15s ease;
  background: var(--color-pure-white);
  color: var(--color-charcoal-ink);
  border: 1px solid var(--color-linen);
}
.filter-pill:hover {
  border-color: var(--color-driftwood);
}
.filter-pill--active {
  background: var(--color-charcoal-ink);
  color: var(--color-pure-white);
  border-color: var(--color-charcoal-ink);
  box-shadow: var(--shadow-subtle);
}
.filter-pill--active::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-pure-white);
}
.medal-card {
  box-shadow: var(--shadow-card);
}
.medal-card-earned {
  border-color: rgba(255, 206, 0, 0.45);
}
.medal-card:hover {
  transform: translateY(-2px);
  border-color: var(--color-driftwood);
}
.medal-emblem {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 76px;
  margin-top: 4px;
  border-radius: 50%;
}
.medal-emblem-earned {
  color: var(--color-charcoal-ink);
  background: color-mix(in srgb, var(--color-sunbeam-yellow) 18%, var(--color-pure-white));
  border: 2px solid var(--color-sunbeam-yellow);
}
.medal-emblem-locked {
  color: var(--color-stone);
  background: var(--color-page-cream);
  border: 1.5px solid var(--color-linen);
}
.medal-tier {
  position: absolute;
  bottom: -10px;
  border-radius: var(--radius-pill);
  background: var(--color-charcoal-ink);
  color: var(--color-pure-white);
  padding: 1px 9px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  box-shadow: var(--shadow-subtle);
}
.medal-emblem-locked .medal-tier {
  background: var(--color-linen);
  color: var(--color-stone);
  box-shadow: none;
}
.medal-progress {
  appearance: none;
  border: 0;
  border-radius: var(--radius-pill);
  overflow: hidden;
  background: var(--color-linen);
}
.medal-progress::-webkit-progress-bar {
  background: var(--color-linen);
}
.medal-progress::-webkit-progress-value {
  background: var(--color-deep-indigo);
  border-radius: var(--radius-pill);
}
.medal-progress::-moz-progress-bar {
  background: var(--color-deep-indigo);
  border-radius: var(--radius-pill);
}
@media (prefers-reduced-motion: reduce) {
  .medal-card {
    transition: none;
  }
  .medal-card:hover {
    transform: none;
  }
}
</style>

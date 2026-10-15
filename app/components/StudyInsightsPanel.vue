<script setup lang="ts">
import { toRef } from 'vue'
import type { HomeCourse } from '~/utils/learningHome'
import { useStudyInsights } from '~/composables/useStudyInsights'
import UiButton from './UiButton.vue'
import PlayboMascot from './PlayboMascot.vue'
import PracticeText from './PracticeText.vue'
const props = defineProps<{ courses: HomeCourse[]; today: string; loading: boolean; error: string }>()
const emit = defineEmits<{ refresh: [] }>()
const insights = useStudyInsights(toRef(props, 'courses'), toRef(props, 'today'))
const { data, kind, offset, ready, busy, exporting, markdown } = insights
function refresh() {
  emit('refresh')
  void insights.load()
}
</script>

<template>
  <section aria-label="学习成长与复盘" class="space-y-5">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex min-w-0 flex-1 items-center gap-4">
        <PlayboMascot :size="88" :bond-level="data.growth.level" class="shrink-0" />
        <div class="min-w-0">
          <p class="text-caption font-bold text-deep-indigo">
            Karen<template v-if="ready && !loading && !error">
              · Lv.{{ data.growth.level }} {{ data.growth.label }}</template
            >
          </p>
          <h2 class="mt-1 text-heading">学习成长与复盘</h2>
          <template v-if="ready && !loading && !error">
            <p class="mt-2 text-caption text-stone">
              累计学习 {{ data.growth.days }} 天 · 累计投入 {{ (data.growth.totalSeconds / 3600).toFixed(1) }} 小时
            </p>
            <p class="mt-1 text-caption text-stone">
              亲密度 {{ data.growth.points }}{{ data.growth.next ? ` / ${data.growth.next}` : ' · 当前最高等级' }}
            </p>
          </template>
        </div>
      </div>
      <UiButton size="sm" variant="ghost" :disabled="loading || insights.loading.value || busy" @click="refresh"
        >刷新记录</UiButton
      >
    </header>
    <p v-if="loading || insights.loading.value" role="status" class="text-body-sm text-stone">正在汇总本地记录…</p>
    <p v-if="error || insights.error.value" role="alert" class="text-body-sm text-error">
      {{ error || insights.error.value }}
    </p>
    <p v-if="data.incomplete" role="alert" class="text-caption text-error">
      部分课程读取失败，统计不完整；请先刷新记录。
    </p>
    <slot name="plan-health" />
    <div class="pane bg-pure-white p-5 md:p-7">
      <template v-if="ready && !loading && !error">
        <div class="flex flex-wrap items-center gap-3">
          <VSelect
            v-model="kind"
            label="报告周期"
            aria-label="报告周期"
            class="w-36 flex-none"
            :items="[
              { title: '周报', value: 'week' },
              { title: '月报', value: 'month' },
            ]"
          />
          <VSelect
            v-model="offset"
            label="时间范围"
            aria-label="时间范围"
            class="w-56 flex-none"
            :items="[
              { title: '本期（截至今日）', value: 0 },
              { title: '上一完整周期', value: -1 },
            ]"
          />
          <span class="text-caption text-stone">{{ data.period.start }} — {{ data.period.end }}</span>
        </div>
        <div class="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div
            v-for="metric in [
              { label: '学习投入 / 小时', value: (data.seconds / 3600).toFixed(1) },
              { label: '达标打卡 / 天', value: data.checked },
              { label: '练习达标 / 题', value: data.solved },
              { label: '标记已掌握 / 个', value: data.mastered.length },
            ]"
            :key="metric.label"
            class="min-w-0 py-2"
          >
            <p class="text-heading tabular">{{ metric.value }}</p>
            <p class="mt-1 text-caption text-stone">{{ metric.label }}</p>
          </div>
        </div>
        <div class="mt-6 border-t border-linen pt-5">
          <h3 class="text-subheading">AI 学习报告</h3>
          <p v-if="!insights.ai.configured.value" class="mt-2 text-caption text-stone">
            请先在设置中配置 AI 服务。{{ insights.ai.state.error }}
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <UiButton :disabled="busy || !insights.ai.configured.value || data.incomplete" @click="insights.generate">{{
              busy ? '正在生成…' : '生成 AI 复盘'
            }}</UiButton>
            <UiButton v-if="busy" variant="ghost" @click="insights.cancel">取消</UiButton>
            <UiButton
              variant="ghost"
              :disabled="busy || exporting || data.incomplete"
              @click="insights.exportReport('md')"
              >导出 Markdown</UiButton
            >
            <UiButton
              variant="ghost"
              :disabled="busy || exporting || data.incomplete"
              @click="insights.exportReport('png')"
              >导出长图 PNG</UiButton
            >
          </div>
          <p v-if="insights.notice.value" role="status" class="mt-3 text-caption text-deep-indigo">
            {{ insights.notice.value }}
          </p>
          <VExpansionPanels class="mt-4">
            <VExpansionPanel value="report-preview" :elevation="0">
              <VExpansionPanelTitle>预览报告</VExpansionPanelTitle>
              <VExpansionPanelText>
                <PracticeText :text="markdown" class="text-body-sm" aria-label="学习报告预览" />
              </VExpansionPanelText>
            </VExpansionPanel>
          </VExpansionPanels>
        </div>
      </template>
    </div>
  </section>
</template>

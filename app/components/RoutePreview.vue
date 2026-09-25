<script setup lang="ts">
import { computed } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import UiButton from '~/components/UiButton.vue'
import type { GuideLesson } from '~/types/guide'
import { formatStudyDuration } from '~/utils/guide'
import { conciseLessonTitle } from '~/utils/studyProgram'

/** 路线调整预览：列出新增、移出与顺序变化的课节，以及对剩余时间的影响；确认后才应用。 */
const guide = useGuide()
const preview = guide.pendingPreview
const pending = computed(() => guide.state.pending)
const LIMIT = 40
function title(path: string) { const v = guide.videoMap.value.get(path); return v ? conciseLessonTitle(v.title) : path }
function names(items: Array<GuideLesson | string>) { return items.slice(0, LIMIT).map(i => title(typeof i === 'string' ? i : i.path)) }
function finishText(day: number | null, days: number) {
  if (day === null) return '已全部看完'
  if (day === Infinity) return '未安排看课时间'
  return `第 ${day} 天${day > days ? `（超出计划 ${day - days} 天）` : ''}`
}
const rows = computed(() => {
  const p = preview.value, plan = guide.state.plan, next = pending.value?.plan
  if (!p || !plan || !next) return []
  const list = [
    { label: '路线课节', before: `${p.countBefore} 节`, after: `${p.countAfter} 节` },
    { label: '剩余视频', before: formatStudyDuration(p.before.remainingSeconds), after: formatStudyDuration(p.after.remainingSeconds) },
  ]
  const program = p.programAfter ?? p.programBefore
  if (program) list.push({ label: '视频看完', before: finishText(p.finishBefore, p.programBefore?.days ?? program.days), after: finishText(p.finishAfter, program.days) })
  else list.push({ label: '视频排期', before: `约 ${p.before.days} 天`, after: `约 ${p.after.days} 天` })
  if (plan.dailyMinutes !== next.dailyMinutes) list.push({ label: '每日看课', before: `${plan.dailyMinutes} 分钟`, after: `${next.dailyMinutes} 分钟` })
  if ((p.programBefore?.days ?? 0) !== (p.programAfter?.days ?? 0)) list.push({ label: '计划周期', before: p.programBefore ? `${p.programBefore.days} 天` : '未设置', after: p.programAfter ? `${p.programAfter.days} 天` : '未设置' })
  if (p.practiceBefore !== p.practiceAfter) list.push({ label: '实践安排', before: `${p.practiceBefore} 个阶段`, after: `${p.practiceAfter} 个阶段` })
  return list
})
</script>

<template>
  <section v-if="pending && preview" class="pane border-2 border-charcoal-ink p-5" aria-label="路线调整预览">
    <p class="text-caption font-bold text-stone">{{ pending.label }} · 待确认</p>
    <h3 class="mt-1 text-subheading">确认路线调整</h3>
    <p class="mt-2 text-body-sm leading-relaxed text-graphite">应用前请核对课节与时间变化。应用后可在“学习路线”中撤销。</p>
    <p class="mt-2 whitespace-pre-wrap break-words text-caption leading-relaxed text-stone">{{ pending.plan.summary }}</p>

    <div class="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-page-cream p-4 text-center">
      <div><p class="text-heading-sm">{{ preview.added.length }}</p><p class="text-caption text-stone">新增课节</p></div>
      <div><p class="text-heading-sm">{{ preview.removed.length }}</p><p class="text-caption text-stone">移出课节</p></div>
      <div><p class="text-heading-sm">{{ preview.moved.length }}</p><p class="text-caption text-stone">顺序调整</p></div>
    </div>

    <table class="mt-4 w-full text-body-sm">
      <caption class="sr-only">调整前后对比</caption>
      <thead><tr class="text-left text-caption text-stone"><th class="py-1 font-medium">项目</th><th class="py-1 font-medium">调整前</th><th class="py-1 font-medium">调整后</th></tr></thead>
      <tbody class="divide-y divide-linen">
        <tr v-for="row in rows" :key="row.label">
          <th scope="row" class="py-2 pr-2 text-left font-bold">{{ row.label }}</th>
          <td class="py-2 pr-2 text-graphite">{{ row.before }}</td>
          <td class="py-2" :class="row.before !== row.after ? 'font-bold' : 'text-graphite'">{{ row.after }}</td>
        </tr>
      </tbody>
    </table>

    <div class="mt-4 space-y-2 text-body-sm">
      <VExpansionPanels v-if="preview.added.length" class="my-3">
        <VExpansionPanel value="content">
          <VExpansionPanelTitle>新增课节（{{ preview.added.length }}）</VExpansionPanelTitle>
          <VExpansionPanelText>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-caption text-graphite"><li v-for="(name, i) in names(preview.added)" :key="i" class="[overflow-wrap:anywhere]">{{ name }}</li></ul>
            <p v-if="preview.added.length > LIMIT" class="mt-1 text-caption text-stone">另有 {{ preview.added.length - LIMIT }} 节</p>
          </VExpansionPanelText>
        </VExpansionPanel>
      </VExpansionPanels>
      <VExpansionPanels v-if="preview.removed.length" class="my-3">
        <VExpansionPanel value="content">
          <VExpansionPanelTitle>移出课节（{{ preview.removed.length }}）</VExpansionPanelTitle>
          <VExpansionPanelText>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-caption text-graphite"><li v-for="(name, i) in names(preview.removed)" :key="i" class="[overflow-wrap:anywhere]">{{ name }}</li></ul>
            <p v-if="preview.removed.length > LIMIT" class="mt-1 text-caption text-stone">另有 {{ preview.removed.length - LIMIT }} 节</p>
          </VExpansionPanelText>
        </VExpansionPanel>
      </VExpansionPanels>
      <VExpansionPanels v-if="preview.moved.length" class="my-3">
        <VExpansionPanel value="content">
          <VExpansionPanelTitle>顺序调整（{{ preview.moved.length }}）</VExpansionPanelTitle>
          <VExpansionPanelText>
            <ul class="mt-2 list-disc space-y-1 pl-5 text-caption text-graphite"><li v-for="(name, i) in names(preview.moved)" :key="i" class="[overflow-wrap:anywhere]">{{ name }}</li></ul>
            <p v-if="preview.moved.length > LIMIT" class="mt-1 text-caption text-stone">另有 {{ preview.moved.length - LIMIT }} 节</p>
          </VExpansionPanelText>
        </VExpansionPanel>
      </VExpansionPanels>
      <p v-if="!preview.added.length && !preview.removed.length && !preview.moved.length" class="text-caption text-stone">路线课节与顺序没有变化。</p>
    </div>

    <div class="mt-5 flex flex-wrap gap-2">
      <UiButton variant="dark" :disabled="!!guide.state.busy" @click="guide.applyPending()">应用调整</UiButton>
      <UiButton variant="ghost" :disabled="!!guide.state.busy" @click="guide.discardPending()">放弃调整</UiButton>
    </div>
  </section>
</template>

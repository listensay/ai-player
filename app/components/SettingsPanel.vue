<script setup lang="ts">
import { ref, watch } from 'vue'
import { buildInfo, diagnosticsReport } from '~/utils/diagnostics'
import { performanceReport } from '~/utils/performance'
import { desktopInvoke } from '~/utils/platform'
import PageSectionNav from '~/components/PageSectionNav.vue'
import AiSettingsPanel from '~/components/AiSettingsPanel.vue'
import ProgrammingSettingsPanel from '~/components/ProgrammingSettingsPanel.vue'
import DataStoragePanel from '~/components/DataStoragePanel.vue'
import UiButton from '~/components/UiButton.vue'
const props = defineProps<{ initialSection?: string }>()
const activeSection = ref<'ai' | 'about' | 'programming' | 'storage'>('ai')
watch(
  () => props.initialSection,
  (section) => {
    activeSection.value =
      section === 'ai' || section === 'about' || section === 'programming' || section === 'storage' ? section : 'ai'
  },
  { immediate: true },
)
const sections = [
  { id: 'ai', title: 'AI 服务设置', icon: 'sparkles' },
  { id: 'programming', title: '编程环境', icon: 'keyboard' },
  { id: 'storage', title: '数据存储', icon: 'folder' },
  { id: 'about', title: '关于与诊断', icon: 'clock' },
] as const
const metrics = ref(performanceReport())
const exporting = ref(false),
  reportMessage = ref(''),
  reportError = ref('')
const metricLabels = {
  'webview-ready': '前端启动',
  'home-load': '首页加载',
  'course-open': '课程打开',
  'video-ready': '视频就绪',
  'programming-ready': '编程编辑器就绪',
}
watch(activeSection, (section) => {
  if (section === 'about') metrics.value = performanceReport()
})
async function exportReport() {
  exporting.value = true
  reportMessage.value = ''
  reportError.value = ''
  try {
    const report = diagnosticsReport({ width: window.innerWidth, height: window.innerHeight })
    const saved = await desktopInvoke<boolean>('export_performance_report', {
      content: JSON.stringify(report, null, 2),
    })
    reportMessage.value = saved ? '性能报告已保存。' : '已取消导出。'
  } catch {
    reportError.value = '性能报告导出失败，请重试。'
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <section class="scroll-soft min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto max-w-5xl px-5 py-8">
      <div class="grid items-start gap-8 sm:grid-cols-[minmax(0,1fr)_168px]">
        <div class="min-w-0">
          <section v-if="activeSection === 'about'" id="settings-about" aria-labelledby="about-heading">
            <h2 id="about-heading" class="text-heading-sm">关于与诊断</h2>
            <div class="pane mt-5 space-y-4 p-5">
              <p class="text-body font-bold">Study Helper {{ buildInfo.version }}</p>
              <p class="text-caption text-stone">
                构建 {{ buildInfo.commit }}{{ buildInfo.dirty ? ' · 包含本地修改' : '' }}<br />{{
                  buildInfo.builtAt ? new Date(buildInfo.builtAt).toLocaleString() : '开发环境'
                }}
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <UiButton size="sm" variant="ghost" @click="metrics = performanceReport()">刷新耗时</UiButton>
                <UiButton size="sm" :disabled="exporting" @click="exportReport">{{
                  exporting ? '正在导出…' : '导出性能报告'
                }}</UiButton>
              </div>
              <table v-if="metrics.length" class="w-full text-left text-body-sm">
                <thead>
                  <tr>
                    <th class="py-2">操作</th>
                    <th>次数</th>
                    <th>中位数</th>
                    <th>P95</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in metrics" :key="row.metric" class="border-t border-linen">
                    <td class="py-2">{{ metricLabels[row.metric] }}</td>
                    <td>{{ row.count }}</td>
                    <td>{{ row.medianMs.toFixed(1) }} ms</td>
                    <td>{{ row.p95Ms.toFixed(1) }} ms</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-body-sm text-stone">完成打开课程、播放或编辑笔记后，可查看对应耗时。</p>
              <p v-if="reportMessage" role="status" class="text-body-sm">{{ reportMessage }}</p>
              <p v-if="reportError" role="alert" class="text-body-sm text-error">{{ reportError }}</p>
            </div>
          </section>
          <DataStoragePanel v-if="activeSection === 'storage'" />
          <ProgrammingSettingsPanel v-if="activeSection === 'programming'" />
          <AiSettingsPanel v-show="activeSection === 'ai'" id="settings-ai" />
        </div>
        <PageSectionNav v-model="activeSection" label="设置导航" prefix="settings" :items="sections" />
      </div>
    </div>
  </section>
</template>

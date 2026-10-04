<script setup lang="ts">
import { ref, watch } from 'vue'
import { buildInfo, diagnosticsReport } from '~/utils/diagnostics'
import { performanceReport } from '~/utils/performance'
import { desktopInvoke } from '~/utils/platform'
import PageSectionNav from '~/components/PageSectionNav.vue'
import { useDesktopSettings } from '~/composables/useDesktopSettings'
import PomodoroSettingsPanel from '~/components/PomodoroSettingsPanel.vue'
import AiSettingsPanel from '~/components/AiSettingsPanel.vue'
import UiButton from '~/components/UiButton.vue'
const settings = useDesktopSettings()
const props = defineProps<{ initialSection?: string }>()
const activeSection = ref<'companion' | 'ai' | 'about' | 'pomodoro'>('companion')
watch(
  () => props.initialSection,
  (section) => {
    activeSection.value = section === 'ai' || section === 'about' || section === 'pomodoro' ? section : 'companion'
  },
  { immediate: true },
)
const sections = [
  { id: 'companion', title: '桌宠设置', icon: 'pip' },
  { id: 'ai', title: 'AI 服务设置', icon: 'sparkles' },
  { id: 'about', title: '关于与诊断', icon: 'clock' },
  { id: 'pomodoro', title: '番茄钟', icon: 'clock' },
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
  'note-ready': '笔记就绪',
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
          <section v-show="activeSection === 'companion'" id="settings-companion" aria-labelledby="companion-heading">
            <h2 id="companion-heading" class="text-heading-sm">桌宠设置</h2>
            <div class="pane mt-5 p-5">
              <VSwitch
                :model-value="settings.state.autoOpenCompanion"
                :disabled="!settings.state.ready || settings.state.saving"
                label="启动时自动打开桌宠"
                color="secondary"
                hide-details
                @update:model-value="settings.setAutoOpenCompanion($event === true)"
              />
              <p class="mt-2 text-caption text-stone">下次启动时生效。</p>
              <p v-if="settings.state.error" role="alert" class="mt-3 text-body-sm text-error">
                {{ settings.state.error }}
                <UiButton v-if="!settings.state.ready" size="sm" variant="text" @click="settings.load">重试</UiButton>
              </p>
            </div>
          </section>
          <section v-if="activeSection === 'about'" id="settings-about" aria-labelledby="about-heading">
            <h2 id="about-heading" class="text-heading-sm">关于与诊断</h2>
            <div class="pane mt-5 space-y-4 p-5">
              <p class="text-body font-bold">AI Player {{ buildInfo.version }}</p>
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
          <PomodoroSettingsPanel v-if="activeSection === 'pomodoro'" />
          <AiSettingsPanel v-show="activeSection === 'ai'" id="settings-ai" />
        </div>
        <PageSectionNav v-model="activeSection" label="设置导航" prefix="settings" :items="sections" />
      </div>
    </div>
  </section>
</template>

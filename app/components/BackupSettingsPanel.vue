<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { desktopInvoke } from '~/utils/platform'
import { flushWorkspace } from '~/utils/workspaceFlush'
import UiButton from './UiButton.vue'
interface Backup {
  id: string
  createdAt: number
  kind: string
  appVersion: string
  courses: number
  notes: number
  exercises: number
  bytes: number
}
interface Status {
  enabled: boolean
  entries: Backup[]
  error: string
  restorePending: boolean
}
const status = ref<Status>(),
  busy = ref(false),
  error = ref(''),
  message = ref(''),
  selected = ref<Backup>()
const kinds: Record<string, string> = {
  automatic: '自动备份',
  manual: '手动备份',
  upgrade: '升级前',
  'before-restore': '恢复前',
  imported: '已导入',
}
const dateLabel = (value: number) => new Date(value).toLocaleString()
async function load() {
  status.value = await desktopInvoke<Status>('backup_status')
}
async function action(work: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await work()
    await load()
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
function backup() {
  return action(async () => {
    await flushWorkspace()
    await desktopInvoke('create_backup')
    message.value = '备份已创建。'
  })
}
function importFile() {
  return action(async () => {
    const entry = await desktopInvoke<Backup | null>('import_backup')
    if (entry) {
      selected.value = entry
      message.value = '备份校验通过。'
    }
  })
}
function restore() {
  const entry = selected.value
  if (!entry) return
  return action(async () => {
    await flushWorkspace()
    await desktopInvoke('restore_backup', { id: entry.id })
    await load()
    await desktopInvoke('restart_after_restore')
  })
}
onMounted(() => void action(async () => {}))
</script>
<template>
  <section id="settings-backups" aria-labelledby="backups-heading" data-testid="backup-settings">
    <h2 id="backups-heading" class="text-heading-sm">备份与恢复</h2>
    <div class="pane mt-5 space-y-4 p-5">
      <VSwitch
        :model-value="status?.enabled ?? true"
        :disabled="busy || !status || status.restorePending"
        label="每日自动备份"
        @update:model-value="
          action(async () => {
            await desktopInvoke('set_backup_enabled', { enabled: $event === true })
          })
        "
      />
      <p class="text-body-sm text-stone">包含学习记录、图片和设置（含 AI 密钥），不含课程视频。</p>
      <div class="flex flex-wrap gap-2">
        <UiButton :disabled="busy || !status || status.restorePending" @click="backup">立即备份</UiButton>
        <UiButton variant="ghost" :disabled="busy || !status || status.restorePending" @click="importFile"
          >导入备份</UiButton
        >
        <UiButton variant="text" :disabled="busy" @click="action(async () => {})">刷新</UiButton>
      </div>
      <p v-if="message" role="status" class="text-body-sm">{{ message }}</p>
      <p v-if="error || status?.error" role="alert" class="text-body-sm text-error">{{ error || status?.error }}</p>
      <div v-if="status?.restorePending" role="status" class="space-y-2">
        <p>恢复已准备完成。</p>
        <UiButton
          :disabled="busy"
          @click="
            action(async () => {
              await desktopInvoke('restart_after_restore')
            })
          "
          >重新启动</UiButton
        >
      </div>
      <ul v-if="status?.entries.length" class="divide-y divide-linen">
        <li
          v-for="entry in status.entries"
          :key="entry.id"
          class="flex flex-wrap items-center justify-between gap-3 py-4"
        >
          <div>
            <p class="text-body-sm font-bold">{{ dateLabel(entry.createdAt) }}</p>
            <p class="mt-1 text-caption text-stone">
              {{ kinds[entry.kind] ?? '备份' }} · {{ entry.courses }} 门课程 · {{ entry.notes }} 篇笔记 ·
              {{ (entry.bytes / 1048576).toFixed(1) }} MB
            </p>
          </div>
          <div class="flex gap-2">
            <UiButton
              size="sm"
              variant="ghost"
              :disabled="busy || status.restorePending"
              @click="
                action(async () => {
                  if (await desktopInvoke('export_backup', { id: entry.id })) message = '备份已导出。'
                })
              "
              >导出</UiButton
            >
            <UiButton size="sm" :disabled="busy || status.restorePending" @click="selected = entry">恢复…</UiButton>
          </div>
        </li>
      </ul>
      <p v-else-if="status" class="text-body-sm text-stone">暂无备份</p>
    </div>
    <VDialog
      :model-value="!!selected"
      :persistent="busy"
      max-width="460"
      @update:model-value="!$event && (selected = undefined)"
    >
      <VCard v-if="selected" class="p-6">
        <h3 class="text-heading-sm">恢复这份备份？</h3>
        <p class="my-4 text-body-sm">
          {{ dateLabel(selected.createdAt) }} · {{ selected.courses }} 门课程 · {{ selected.notes }} 篇笔记
        </p>
        <p class="mb-5 text-body-sm">当前数据会先备份，再恢复所选版本并重新启动。</p>
        <p v-if="error" role="alert" class="mb-4 text-body-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UiButton variant="ghost" :disabled="busy" @click="selected = undefined">取消</UiButton>
          <UiButton :disabled="busy" @click="restore">{{ busy ? '正在准备…' : '恢复并重启' }}</UiButton>
        </div>
      </VCard>
    </VDialog>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { desktopInvoke } from '~/utils/platform'
import UiButton from '~/components/UiButton.vue'

interface StorageLocation {
  path: string | null
  pendingPath: string | null
  pendingAction: 'move' | 'open' | null
}
const location = ref<StorageLocation | null>(null)
const busy = ref(false)
const error = ref('')
async function load() {
  busy.value = true
  error.value = ''
  try {
    location.value = await desktopInvoke<StorageLocation>('data_storage_info')
  } catch {
    error.value = '数据位置读取失败，请重试。'
  } finally {
    busy.value = false
  }
}
async function choose(existing = false) {
  busy.value = true
  error.value = ''
  try {
    location.value = await desktopInvoke<StorageLocation>('choose_data_directory', { existing })
  } catch (cause) {
    error.value = typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : '位置更改失败，请重试。'
  } finally {
    busy.value = false
  }
}
async function cancel() {
  busy.value = true
  error.value = ''
  try {
    location.value = await desktopInvoke<StorageLocation>('cancel_data_directory')
  } catch {
    error.value = '取消切换失败，请重试。'
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <section id="settings-storage" aria-labelledby="storage-heading">
    <h2 id="storage-heading" class="text-heading-sm">数据存储</h2>
    <div class="pane mt-5 space-y-4 p-5">
      <p class="text-body font-bold">存储位置</p>
      <template v-if="location">
        <p class="break-all text-body-sm text-stone">{{ location.path || '系统应用数据文件夹' }}</p>
        <div v-if="location.pendingPath" role="status" class="space-y-2 border-t border-linen pt-4">
          <p class="break-all text-body-sm">{{ location.pendingPath }}</p>
          <p class="text-body-sm text-stone">
            {{
              location.pendingAction === 'open' ? '重新打开应用后使用所选数据。' : '重新打开应用后迁移全部学习数据。'
            }}
          </p>
        </div>
        <p class="text-body-sm text-stone">课程列表、笔记、学习记录与设置。</p>
        <div class="flex flex-wrap gap-2">
          <UiButton size="sm" :disabled="busy" @click="choose(false)">迁移当前数据</UiButton>
          <UiButton size="sm" variant="ghost" :disabled="busy" @click="choose(true)">打开已有数据</UiButton>
          <UiButton v-if="location.pendingPath" size="sm" variant="ghost" :disabled="busy" @click="cancel"
            >取消切换</UiButton
          >
        </div>
        <p class="text-body-sm text-stone">两台电脑接续使用时，先退出应用，再同步整个数据文件夹。</p>
      </template>
      <UiButton v-else size="sm" :disabled="busy" @click="load">{{ busy ? '正在读取…' : '重试' }}</UiButton>
      <p v-if="error" role="alert" class="text-body-sm text-error">{{ error }}</p>
    </div>
  </section>
</template>

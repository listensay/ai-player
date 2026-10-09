<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { APP_DIALOG_TITLES, useAppDialogs } from '~/composables/useAppDialogs'
import AppIcon from './AppIcon.vue'
import UiButton from './UiButton.vue'

const dialogs = useAppDialogs()
const panels = {
  settings: defineAsyncComponent(() => import('./SettingsPanel.vue')),
  study: defineAsyncComponent(() => import('./StudyManagementPanel.vue')),
}
const title = computed(() => (dialogs.current.value ? APP_DIALOG_TITLES[dialogs.current.value.kind] : ''))
const previousTitle = computed(() => {
  const previous = dialogs.stack.value.at(-2)
  return previous ? APP_DIALOG_TITLES[previous.kind] : ''
})
const heading = ref<HTMLElement>()
let opener: HTMLElement | null = null
watch(
  dialogs.isOpen,
  (open) => {
    if (open) opener = document.activeElement as HTMLElement | null
  },
  { flush: 'sync' },
)
async function afterLeave() {
  dialogs.afterLeave()
  await nextTick()
  if (!dialogs.isOpen.value && opener?.isConnected && !opener.closest('[inert]')) {
    opener.focus({ preventScroll: true })
    opener = null
  }
}
watch(
  () => dialogs.current.value?.kind,
  async () => {
    await nextTick()
    if (dialogs.isOpen.value) heading.value?.focus({ preventScroll: true })
  },
)
</script>

<template>
  <VDialog
    :model-value="dialogs.isOpen.value"
    fullscreen
    transition="dialog-bottom-transition"
    aria-labelledby="app-utility-title"
    @update:model-value="!$event && dialogs.close()"
    @after-leave="afterLeave"
  >
    <div class="app-utility-surface flex flex-col overflow-hidden bg-pure-white text-charcoal-ink">
      <header class="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-linen px-5 sm:px-8">
        <div class="flex min-w-0 items-center gap-3">
          <UiButton
            v-if="previousTitle"
            size="sm"
            variant="text"
            :title="'返回' + previousTitle"
            @click="dialogs.back()"
          >
            <AppIcon name="chevron-right" class="rotate-180" :size="18" />返回
          </UiButton>
          <h1 id="app-utility-title" ref="heading" tabindex="-1" class="truncate text-heading-sm">{{ title }}</h1>
        </div>
        <UiButton
          size="sm"
          variant="ghost"
          :title="'关闭' + title"
          :aria-label="'关闭' + title"
          @click="dialogs.close()"
        >
          <AppIcon name="close" :size="18" />关闭
        </UiButton>
      </header>
      <div
        v-for="entry in dialogs.stack.value"
        v-show="entry.kind === dialogs.current.value?.kind"
        :key="entry.kind"
        :inert="entry.kind !== dialogs.current.value?.kind"
        class="flex min-h-0 flex-1 flex-col"
      >
        <component :is="panels[entry.kind]" :initial-section="entry.section" />
      </div>
    </div>
  </VDialog>
</template>

<style scoped>
.app-utility-surface {
  height: 100dvh;
  max-height: 100dvh;
  border-radius: 0;
}
</style>

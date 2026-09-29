<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '~/components/AppIcon.vue'
import { usePageTitle } from '~/composables/usePageTitle'
import { useDesktopSettings } from '~/composables/useDesktopSettings'
import AiSettingsPanel from '~/components/AiSettingsPanel.vue'
import UiButton from '~/components/UiButton.vue'
const settings = useDesktopSettings()
const route = useRoute()
const activeSection = ref<'companion' | 'ai'>('companion')
watch(() => route.query.section, section => { activeSection.value = section === 'ai' ? 'ai' : 'companion' }, { immediate: true })
usePageTitle('设置 · AI Player')
</script>

<template>
  <main class="scroll-soft min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto max-w-5xl px-5 py-8">
      <h1 class="mb-8 text-heading-sm">设置</h1>
      <div class="grid items-start gap-8 sm:grid-cols-[minmax(0,1fr)_168px]">
        <div class="min-w-0">
          <section v-show="activeSection === 'companion'" id="settings-companion" aria-labelledby="companion-heading">
            <h2 id="companion-heading" class="text-heading-sm">桌宠设置</h2>
            <div class="pane mt-5 p-5">
              <VSwitch :model-value="settings.state.autoOpenCompanion" :disabled="!settings.state.ready || settings.state.saving"
                label="启动时自动打开桌宠" color="secondary" hide-details
                @update:model-value="settings.setAutoOpenCompanion($event === true)" />
              <p class="mt-2 text-caption text-stone">保存后在下次启动时生效。关闭自动打开后，仍可从顶部的「桌面挂件」手动打开。</p>
              <p v-if="settings.state.error" role="alert" class="mt-3 text-body-sm text-error">{{ settings.state.error }}
                <UiButton v-if="!settings.state.ready" size="sm" variant="text" @click="settings.load">重试</UiButton>
              </p>
            </div>
          </section>
          <AiSettingsPanel v-show="activeSection === 'ai'" id="settings-ai" />
        </div>
        <nav aria-label="设置导航" class="order-first flex gap-2 sm:sticky sm:top-8 sm:order-last sm:flex-col sm:border-l sm:border-linen sm:pl-4">
          <button type="button" aria-controls="settings-companion" :aria-current="activeSection === 'companion' ? 'page' : undefined"
            class="flex items-center gap-2 rounded-xl px-4 py-3 text-left text-body-sm font-bold hover:bg-linen/40 focus-visible:outline-2 focus-visible:outline-deep-indigo"
            :class="activeSection === 'companion' ? 'bg-pure-white text-deep-indigo' : 'text-stone'" @click="activeSection = 'companion'">
            <AppIcon name="pip" :size="18" />桌宠设置
          </button>
          <button type="button" aria-controls="settings-ai" :aria-current="activeSection === 'ai' ? 'page' : undefined"
            class="flex items-center gap-2 rounded-xl px-4 py-3 text-left text-body-sm font-bold hover:bg-linen/40 focus-visible:outline-2 focus-visible:outline-deep-indigo"
            :class="activeSection === 'ai' ? 'bg-pure-white text-deep-indigo' : 'text-stone'" @click="activeSection = 'ai'">
            <AppIcon name="sparkles" :size="18" />AI 服务设置
          </button>
        </nav>
      </div>
    </div>
  </main>
</template>

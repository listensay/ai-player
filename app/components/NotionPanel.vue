<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useNotionBinding } from '~/composables/useNotionBinding'
import { useNotionView } from '~/composables/useNotionView'
import { NOTION_HOME, notionBindingKey } from '~/utils/notion'
import { desktopInvoke } from '~/utils/platform'
import AppIcon from './AppIcon.vue'
import UiButton from './UiButton.vue'

const props = defineProps<{ courseId: string; path: string; active: boolean; blocked: boolean }>()
const binding = useNotionBinding(computed(() => ({ courseId: props.courseId, path: props.path })))
const host = ref<HTMLElement | null>(null)
const draft = ref(''),
  editing = ref(false),
  browsing = ref(false),
  loading = ref(false),
  notice = ref(''),
  external = ref('')
const key = computed(() => notionBindingKey(props.courseId, props.path))
const target = computed(() =>
  props.active && !props.blocked && binding.state.ready && (binding.state.url || browsing.value)
    ? { key: key.value, url: binding.state.url || NOTION_HOME }
    : null,
)
const view = useNotionView(host, target)
watch(
  key,
  () => {
    browsing.value = false
    editing.value = false
    draft.value = ''
    external.value = ''
    notice.value = ''
  },
  { flush: 'sync' },
)
watch(
  () => binding.state.url,
  (url) => {
    draft.value = url
  },
)
async function bind(raw = draft.value) {
  if (await binding.save(raw)) {
    editing.value = false
    browsing.value = true
    notice.value = ''
  }
}
async function action(kind: 'back' | 'reload' | 'bind' | 'external') {
  const expected = key.value
  try {
    const url = await view.action(kind === 'bind' || kind === 'external' ? 'url' : kind)
    if (expected !== key.value) return
    if (kind === 'bind') await bind(url)
    if (kind === 'external') await desktopInvoke('open_learning_resource', { location: url })
  } catch (error) {
    notice.value = String(error)
  }
}
async function openExternal() {
  try {
    await desktopInvoke('open_learning_resource', { location: external.value })
  } catch (error) {
    notice.value = String(error)
  }
}
let disposed = false
const stops: Array<() => void> = []
onMounted(async () => {
  const { listen } = await import('@tauri-apps/api/event')
  const handles = await Promise.all([
    listen<{ url: string; loading: boolean }>('notion-page', (event) => {
      loading.value = event.payload.loading
    }),
    listen<string>('notion-external', (event) => {
      external.value = event.payload
      loading.value = false
    }),
    listen<string>('notion-popup-error', (event) => {
      notice.value = event.payload
      loading.value = false
    }),
  ]).catch(() => [])
  if (disposed) handles.forEach((stop) => stop())
  else stops.push(...handles)
})
onBeforeUnmount(() => {
  disposed = true
  stops.forEach((stop) => stop())
})
</script>

<template>
  <section class="notion-panel flex min-h-0 flex-1 flex-col" aria-label="Notion 笔记">
    <div class="shrink-0 space-y-2 border-b border-linen p-3">
      <div v-if="binding.state.url || browsing" class="flex flex-wrap items-center gap-1">
        <UiButton icon size="sm" title="Notion 后退" @click="action('back')"
          ><AppIcon name="arrow-left" :size="16"
        /></UiButton>
        <UiButton icon size="sm" title="重新加载 Notion" @click="action('reload')"
          ><AppIcon name="reset" :size="16"
        /></UiButton>
        <UiButton size="sm" :disabled="binding.state.saving" @click="action('bind')">绑定当前页</UiButton>
        <UiButton size="sm" variant="text" @click="editing = !editing">页面链接</UiButton>
        <UiButton icon size="sm" title="在浏览器打开 Notion" class="ml-auto" @click="action('external')"
          ><AppIcon name="expand" :size="16"
        /></UiButton>
      </div>
      <form
        v-if="binding.state.ready && (editing || (!binding.state.url && !browsing))"
        class="space-y-3"
        @submit.prevent="bind()"
      >
        <label class="block text-body-sm font-medium" for="notion-page-url">本课 Notion 页面</label>
        <input
          id="notion-page-url"
          v-model="draft"
          type="url"
          placeholder="粘贴 Notion 页面链接"
          autocomplete="off"
          maxlength="4096"
          class="w-full min-w-0 rounded-xl border border-linen bg-pure-white px-3 py-2 text-body-sm outline-none focus:border-deep-indigo"
          :disabled="binding.state.saving"
        />
        <div class="flex flex-wrap gap-2">
          <UiButton type="submit" variant="dark" size="sm" :disabled="!draft.trim() || binding.state.saving"
            >绑定并打开</UiButton
          >
          <UiButton v-if="!binding.state.url && !browsing" size="sm" @click="browsing = true">打开 Notion</UiButton>
          <UiButton
            v-if="binding.state.url"
            variant="text"
            size="sm"
            :disabled="binding.state.saving"
            @click="
              binding.save('').then((saved) => {
                if (saved) browsing = false
              })
            "
            >解除绑定</UiButton
          >
        </div>
      </form>
      <p v-if="!binding.state.ready && !binding.state.error" role="status" class="text-caption text-stone">
        正在读取页面…
      </p>
      <p v-if="loading && target" role="status" class="text-caption text-stone">正在打开 Notion…</p>
      <div v-if="binding.state.error || view.error.value || notice" role="alert" class="text-body-sm text-error">
        {{ binding.state.error || view.error.value || notice }}
        <UiButton v-if="!binding.state.ready" variant="text" size="sm" @click="binding.load">重试</UiButton>
        <UiButton v-else-if="view.error.value" variant="text" size="sm" @click="view.retry">重试</UiButton>
      </div>
      <div v-if="external" class="flex flex-wrap items-center gap-2 text-caption text-stone">
        <span>此链接需在浏览器打开</span>
        <UiButton size="sm" variant="text" @click="openExternal">打开</UiButton>
        <UiButton size="sm" variant="text" @click="external = ''">关闭</UiButton>
      </div>
    </div>
    <div ref="host" class="notion-webview-slot min-h-[240px] flex-1 bg-pure-white" data-testid="notion-webview-slot">
      <p v-if="binding.state.ready && !binding.state.url && !browsing" class="p-5 text-body-sm text-stone">
        连接本课页面，边看边记。
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import AiProfileSelector from '~/components/AiProfileSelector.vue'
import UiButton from '~/components/UiButton.vue'
import { VSnackbar } from 'vuetify/components/VSnackbar'
import { VCombobox } from 'vuetify/components/VCombobox'
import AppIcon from '~/components/AppIcon.vue'
import { testAiConnection } from '~/utils/aiConnectionTest'
import { emptyAiSettings } from '~/utils/aiSettings'
import { fetchAiModels } from '~/utils/aiModels'
const guide = useGuide()
const { ai } = guide
const editingId = ref('')
const draft = reactive({ ...emptyAiSettings(), name: '', modelIds: [] as string[] })
const notice = reactive({ open: false, success: true, title: '', detail: '' })
const testing = ref(false)
const loadingModels = ref(false)
const modelIds = ref<string[]>([])
const modelError = ref('')
const testReport = ref<{ success: boolean; detail: string } | null>(null)
let testController: AbortController | undefined
let modelsController: AbortController | undefined
let disposed = false
function notify(success: boolean, title: string, detail: string) {
  notice.open = false
  Object.assign(notice, { open: true, success, title, detail })
}
onBeforeUnmount(() => {
  disposed = true
  testController?.abort()
  modelsController?.abort()
})
async function loadModels() {
  if (disabled.value) return
  loadingModels.value = true
  modelError.value = ''
  modelIds.value = []
  const controller = new AbortController()
  modelsController = controller
  try {
    const ids = await fetchAiModels({ ...draft }, controller.signal)
    if (!disposed && !controller.signal.aborted) modelIds.value = ids
  } catch (err) {
    if (!disposed && !controller.signal.aborted)
      modelError.value = `${(err as Error).message} 可手动填写服务提供的模型 ID。`
  } finally {
    if (modelsController === controller) {
      loadingModels.value = false
      modelsController = undefined
    }
  }
}
async function testConnection() {
  if (disabled.value) return
  testing.value = true
  notice.open = false
  testReport.value = null
  const controller = new AbortController()
  testController = controller
  const settings = { ...draft }
  try {
    const result = await testAiConnection(settings, controller.signal)
    if (!disposed && !controller.signal.aborted)
      testReport.value = {
        success: true,
        detail: `模型 ${settings.model.trim()} 已生成 ${result.lessonCount} 节样例路线并通过导学校验，耗时 ${(result.milliseconds / 1000).toFixed(1)} 秒。`,
      }
  } catch (err) {
    if (!disposed)
      testReport.value = { success: false, detail: controller.signal.aborted ? '测试已取消。' : (err as Error).message }
  } finally {
    testing.value = false
    testController = undefined
  }
}
const error = ref('')
const confirmingDelete = ref(false)
const disabled = computed(
  () => !ai.state.ready || ai.state.saving || !!guide.state.busy || testing.value || loadingModels.value,
)
const usesDraft = computed(() => {
  const active = ai.state.collection.profiles.find((p) => p.id === ai.state.collection.activeId)
  return (
    !!active &&
    active.id === editingId.value &&
    active.baseUrl === draft.baseUrl.trim() &&
    active.model === draft.model.trim() &&
    active.apiKey === draft.apiKey.trim() &&
    (active.provider ?? 'openai') === draft.provider &&
    (active.contextWindow ?? 'default') === draft.contextWindow &&
    active.timeoutMinutes === draft.timeoutMinutes
  )
})
watch(
  () => [draft.provider, draft.baseUrl, draft.apiKey],
  () => {
    modelsController?.abort()
    modelIds.value = []
    modelError.value = ''
  },
  { flush: 'sync' },
)
watch(
  () => [
    editingId.value,
    draft.provider,
    draft.contextWindow,
    draft.baseUrl,
    draft.model,
    draft.apiKey,
    draft.timeoutMinutes,
  ],
  () => {
    testController?.abort()
    testReport.value = null
  },
  { flush: 'sync' },
)

function edit(id = '') {
  const profile = ai.state.collection.profiles.find((p) => p.id === id)
  editingId.value = profile?.id ?? ''
  Object.assign(
    draft,
    emptyAiSettings(),
    { name: '', modelIds: [] },
    profile
      ? {
          provider: profile.provider ?? 'openai',
          contextWindow: profile.contextWindow ?? 'default',
          name: profile.name,
          baseUrl: profile.baseUrl,
          model: profile.model,
          apiKey: profile.apiKey,
          timeoutMinutes: profile.timeoutMinutes,
          modelIds: [...(profile.modelIds ?? [profile.model])].filter(Boolean),
        }
      : {},
  )
  notice.open = false
  error.value = ''
  confirmingDelete.value = false
}
function setModels(ids: string[]) {
  draft.modelIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (!draft.modelIds.includes(draft.model)) draft.model = draft.modelIds[0] ?? ''
}
watch(
  () => ai.state.ready,
  (ready) => {
    if (ready) edit(ai.state.collection.activeId || ai.state.collection.profiles[0]?.id)
  },
  { immediate: true },
)

async function save() {
  if (disabled.value) return
  error.value = ''
  notice.open = false
  try {
    const savedId = await ai.saveProfile({ ...draft, modelIds: [...draft.modelIds] }, editingId.value || undefined)
    // 保存同一份已测试表单时保留测试结果；切换编辑目标才清空。
    const report = testReport.value
    editingId.value = savedId
    testReport.value = report
    notify(
      true,
      'AI 配置已保存并启用',
      `「${draft.name.trim()}」已设为当前配置。后续 AI 请求将使用模型 ${draft.model.trim()}。`,
    )
    confirmingDelete.value = false
  } catch (err) {
    error.value = (err as Error).message
    notify(false, '保存配置失败', error.value)
  }
}
async function remove() {
  if (disabled.value) return
  error.value = ''
  try {
    await ai.deleteProfile(editingId.value)
    edit(ai.state.collection.activeId || ai.state.collection.profiles[0]?.id)
    notify(
      true,
      '配置已删除',
      ai.state.collection.activeId ? '其他已保存的配置仍可使用。' : '请选择或新增 AI 配置后继续使用 AI 功能。',
    )
  } catch (err) {
    error.value = (err as Error).message
    notify(false, '删除配置失败', error.value)
  }
}
</script>

<template>
  <section class="w-full min-w-0" aria-label="AI 配置管理">
    <h2 class="text-heading-sm">AI 服务设置</h2>
    <div v-if="ai.state.error" role="alert" class="pane mt-4 p-4 text-body-sm text-error">
      {{ ai.state.error
      }}<UiButton variant="text" size="sm" class="ml-2" :disabled="ai.state.loading" @click="ai.load"
        >重新加载</UiButton
      >
    </div>
    <div class="pane mt-5 space-y-4 p-5">
      <AiProfileSelector :disabled="disabled" @selected="edit" />
      <div class="flex items-center justify-between gap-3 border-t border-linen pt-4">
        <h4 class="text-body-sm font-bold">已保存的配置</h4>
        <UiButton size="sm" :disabled="disabled" @click="edit()">新增配置</UiButton>
      </div>
      <ul v-if="ai.state.collection.profiles.length" class="grid gap-2 sm:grid-cols-2" aria-label="已保存的 AI 配置">
        <li v-for="profile in ai.state.collection.profiles" :key="profile.id" class="min-w-0">
          <button
            type="button"
            :disabled="disabled"
            :aria-pressed="editingId === profile.id"
            :aria-label="`编辑配置 ${profile.name}`"
            class="w-full min-w-0 rounded-xl border p-3 text-left disabled:opacity-60"
            :class="editingId === profile.id ? 'border-deep-indigo bg-deep-indigo/5' : 'border-linen'"
            @click="edit(profile.id)"
          >
            <span class="flex items-start gap-2"
              ><span class="min-w-0 flex-1 break-words text-body-sm font-bold">{{ profile.name }}</span
              ><span v-if="profile.id === ai.state.collection.activeId" class="shrink-0 text-caption text-deep-indigo"
                >使用中</span
              ></span
            >
            <span class="mt-1 block truncate text-caption text-stone">{{ profile.model }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="text-caption text-stone">添加配置以启用 AI 功能。</p>
    </div>

    <form class="pane mt-5 space-y-4 p-5" @submit.prevent="save">
      <h4 class="text-body font-bold">{{ editingId ? '编辑配置' : '新增配置' }}</h4>
      <fieldset :disabled="disabled" class="min-w-0 space-y-4 disabled:opacity-60">
        <VTextField
          v-model="draft.name"
          required
          maxlength="60"
          placeholder="例如：日常学习、本地模型"
          label="配置名称"
        />
        <VSelect
          v-model="draft.provider"
          label="接口格式"
          :disabled="disabled"
          :items="[
            { title: 'OpenAI 兼容', value: 'openai' },
            { title: 'Anthropic', value: 'anthropic' },
          ]"
        />
        <VTextField
          v-model="draft.baseUrl"
          type="url"
          required
          autocomplete="off"
          :placeholder="draft.provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.example.com/v1'"
          label="服务地址"
        />
        <div class="flex flex-wrap items-start gap-3">
          <VCombobox
            :model-value="draft.modelIds"
            :items="modelIds"
            :return-object="false"
            :disabled="disabled"
            multiple
            chips
            closable-chips
            autocomplete="off"
            label="可选模型 ID"
            hide-no-data
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            color="secondary"
            bg-color="surface"
            rounded="lg"
            class="min-w-0 flex-1 basis-64"
            @update:model-value="setModels($event)"
          />
          <UiButton :disabled="disabled || !draft.baseUrl.trim()" @click="loadModels">{{
            loadingModels ? '读取中…' : '读取模型列表'
          }}</UiButton>
        </div>
        <VSelect
          v-if="draft.modelIds.length"
          v-model="draft.model"
          :items="draft.modelIds"
          label="当前模型 ID"
          :disabled="disabled"
        />
        <p v-if="modelError" role="alert" class="text-caption text-error">{{ modelError }}</p>
        <p v-else-if="modelIds.length" role="status" class="text-caption text-stone">
          已读取 {{ modelIds.length }} 个模型。
        </p>
        <VSelect
          v-if="draft.provider === 'anthropic'"
          v-model="draft.contextWindow"
          label="模型上下文"
          :disabled="disabled"
          :items="[
            { title: '默认', value: 'default' },
            { title: '1M（100 万 token）', value: '1m' },
          ]"
        />
        <VTextField
          v-model="draft.apiKey"
          type="password"
          autocomplete="off"
          placeholder="无需密钥的本地服务可留空"
          label="API 密钥"
        />
        <VTextField
          v-model.number="draft.timeoutMinutes"
          type="number"
          min="1"
          max="30"
          step="1"
          required
          label="响应时限（分钟）"
        />
        <div class="flex flex-wrap gap-2">
          <UiButton @click="testConnection">{{ testing ? '测试中…' : '测试导学' }}</UiButton>
          <UiButton type="submit" variant="primary">{{ ai.state.saving ? '保存中…' : '保存并使用' }}</UiButton>
          <UiButton v-if="editingId" variant="text" @click="confirmingDelete = !confirmingDelete">删除配置</UiButton>
          <UiButton
            v-if="!editingId && ai.state.collection.profiles.length"
            variant="text"
            @click="edit(ai.state.collection.activeId || ai.state.collection.profiles[0]?.id)"
            >取消新增</UiButton
          >
        </div>
        <div v-if="confirmingDelete" class="rounded-xl border border-error/30 p-4 text-body-sm">
          <p>确认删除“{{ draft.name }}”？</p>
          <div class="mt-3 flex gap-2">
            <UiButton size="sm" @click="remove">确认删除</UiButton
            ><UiButton size="sm" variant="text" @click="confirmingDelete = false">取消</UiButton>
          </div>
        </div>
      </fieldset>
      <p v-if="error" role="alert" class="text-body-sm text-error">{{ error }}</p>
      <div
        v-if="testing"
        role="status"
        class="flex items-center justify-between gap-3 rounded-xl bg-page-cream p-3 text-body-sm"
      >
        <span>正在生成样例学习路线并校验结果…</span>
        <UiButton size="sm" variant="text" @click="testController?.abort()">取消测试</UiButton>
      </div>
      <div
        v-if="testReport"
        :role="testReport.success ? 'status' : 'alert'"
        class="rounded-xl border border-linen p-4 text-body-sm"
      >
        <p class="font-bold" :class="testReport.success ? 'text-deep-indigo' : 'text-error'">
          {{ testReport.success ? '导学测试通过' : '导学测试未通过' }}
        </p>
        <p class="mt-2 break-words">{{ testReport.detail }}</p>
        <p v-if="testReport.success && !usesDraft" class="mt-2 text-caption text-stone">
          点击「保存并使用」后启用此配置。
        </p>
      </div>
    </form>
    <VSnackbar
      v-model="notice.open"
      location="top right"
      :timeout="notice.success ? 6000 : -1"
      color="surface"
      rounded="xl"
      max-width="460"
    >
      <div class="flex items-start gap-3 py-1" :role="notice.success ? 'status' : 'alert'">
        <AppIcon
          :name="notice.success ? 'check' : 'close'"
          :size="22"
          :class="notice.success ? 'text-deep-indigo' : 'text-error'"
        />
        <div class="min-w-0">
          <p class="text-body-sm font-bold">{{ notice.title }}</p>
          <p class="mt-1 break-words text-caption leading-relaxed text-stone">{{ notice.detail }}</p>
        </div>
      </div>
      <template #actions
        ><UiButton icon size="sm" variant="text" title="关闭提示" @click="notice.open = false"
          ><AppIcon name="close" :size="18" /></UiButton
      ></template>
    </VSnackbar>
  </section>
</template>

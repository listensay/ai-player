<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useGuide } from '~/composables/useLearningGuide'
import AiProfileSelector from '~/components/AiProfileSelector.vue'
import UiButton from '~/components/UiButton.vue'
import { emptyAiSettings } from '~/utils/aiSettings'
const emit = defineEmits<{ done: [] }>()
const guide = useGuide()
const { ai } = guide
const editingId = ref('')
const draft = reactive({ ...emptyAiSettings(), name: '' })
const message = ref('')
const error = ref('')
const confirmingDelete = ref(false)
const disabled = computed(() => !ai.state.ready || ai.state.saving || !!guide.state.busy)

function edit(id = '') {
  const profile = ai.state.collection.profiles.find(p => p.id === id)
  editingId.value = profile?.id ?? ''
  Object.assign(draft, emptyAiSettings(), { name: '' }, profile ? {
    name: profile.name, baseUrl: profile.baseUrl, model: profile.model, apiKey: profile.apiKey, timeoutMinutes: profile.timeoutMinutes, maxTokens: profile.maxTokens || undefined,
  } : {})
  // 未设置上限时留空；0 会触发输入框的最小值校验，导致新增配置无法提交。
  draft.maxTokens = profile?.maxTokens || undefined
  message.value = ''; error.value = ''; confirmingDelete.value = false
}
watch(() => ai.state.ready, ready => { if (ready) edit(ai.state.collection.activeId || ai.state.collection.profiles[0]?.id) }, { immediate: true })

async function save() {
  if (disabled.value) return
  error.value = ''; message.value = ''
  try {
    editingId.value = await ai.saveProfile({ ...draft }, editingId.value || undefined)
    message.value = '配置已保存并启用。'
    confirmingDelete.value = false
  } catch (err) { error.value = (err as Error).message }
}
async function remove() {
  if (disabled.value) return
  error.value = ''
  try {
    await ai.deleteProfile(editingId.value)
    edit(ai.state.collection.activeId || ai.state.collection.profiles[0]?.id)
    message.value = ai.state.collection.activeId ? '配置已删除。' : '配置已删除，请选择或新增要使用的 AI。'
  } catch (err) { error.value = (err as Error).message }
}
</script>

<template>
  <section class="mx-auto max-w-2xl" aria-label="AI 配置管理">
    <h3 class="text-heading-sm">AI 服务配置</h3>
    <p class="mt-2 text-body-sm leading-relaxed text-graphite">保存多组服务与模型配置，按需选择用于学习路线、疑问回溯和课后练习的 AI。</p>
    <div v-if="ai.state.error" role="alert" class="pane mt-4 p-4 text-body-sm text-error">
      {{ ai.state.error }}<button type="button" class="ml-2 underline" :disabled="ai.state.loading" @click="ai.load">重新读取</button>
    </div>
    <div class="pane mt-5 space-y-4 p-5">
      <AiProfileSelector :disabled="!!guide.state.busy" @selected="edit" />
      <div class="flex items-center justify-between gap-3 border-t border-linen pt-4">
        <h4 class="text-body-sm font-bold">已保存的配置</h4>
        <UiButton size="sm" :disabled="disabled" @click="edit()">新增配置</UiButton>
      </div>
      <ul v-if="ai.state.collection.profiles.length" class="grid gap-2 sm:grid-cols-2" aria-label="已保存的 AI 配置">
        <li v-for="profile in ai.state.collection.profiles" :key="profile.id" class="min-w-0">
          <button type="button" :disabled="disabled" :aria-pressed="editingId === profile.id" :aria-label="`编辑配置 ${profile.name}`"
            class="w-full min-w-0 rounded-xl border p-3 text-left disabled:opacity-60" :class="editingId === profile.id ? 'border-deep-indigo bg-deep-indigo/5' : 'border-linen'" @click="edit(profile.id)">
            <span class="flex items-start gap-2"><span class="min-w-0 flex-1 break-words text-body-sm font-bold">{{ profile.name }}</span><span v-if="profile.id === ai.state.collection.activeId" class="shrink-0 text-caption text-deep-indigo">使用中</span></span>
            <span class="mt-1 block truncate text-caption text-stone">{{ profile.model }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="text-caption text-stone">添加首组配置后即可使用 AI 功能。</p>
    </div>

    <form class="pane mt-5 space-y-4 p-5" @submit.prevent="save">
      <h4 class="text-body font-bold">{{ editingId ? '编辑配置' : '新增配置' }}</h4>
      <fieldset :disabled="disabled" class="min-w-0 space-y-4 disabled:opacity-60">
        <label class="block text-body-sm font-bold">配置名称<input v-model="draft.name" required maxlength="60" class="ai-input mt-2" placeholder="例如：日常学习、本地模型" /></label>
        <label class="block text-body-sm font-bold">服务地址<input v-model="draft.baseUrl" type="url" required autocomplete="off" class="ai-input mt-2" placeholder="https://api.example.com/v1" /></label>
        <p class="text-caption text-stone">支持 OpenAI 兼容服务；本机 Ollama 可使用 http://localhost:11434/v1。</p>
        <label class="block text-body-sm font-bold">模型名称<input v-model="draft.model" required autocomplete="off" class="ai-input mt-2" placeholder="填写服务支持的模型名称" /></label>
        <label class="block text-body-sm font-bold">API 密钥<input v-model="draft.apiKey" type="password" autocomplete="off" class="ai-input mt-2" placeholder="本机无鉴权服务可留空" /></label>
        <label class="block text-body-sm font-bold">响应超时时长（分钟）<input v-model.number="draft.timeoutMinutes" type="number" min="1" max="30" step="1" required class="ai-input mt-2" /></label>
        <label class="block text-body-sm font-bold">最大输出长度（token）<input v-model.number="draft.maxTokens" type="number" min="256" max="1000000" step="1" class="ai-input mt-2" placeholder="留空则使用服务默认值" /></label>
        <p class="text-caption text-stone">课程较多时学习路线较长，若提示输出被截断，请调高此值（例如 32000），且不超过所选模型的输出上限。</p>
        <p class="text-caption text-stone">各组配置独立保存，切换后新请求使用所选 AI。服务配置与密钥保存在本地。</p>
        <div class="flex flex-wrap gap-2">
          <UiButton type="submit" variant="primary">{{ ai.state.saving ? '保存中…' : '保存并使用' }}</UiButton>
          <UiButton v-if="editingId" variant="text" @click="confirmingDelete = !confirmingDelete">删除配置</UiButton>
          <UiButton v-if="!editingId && ai.state.collection.profiles.length" variant="text" @click="edit(ai.state.collection.activeId || ai.state.collection.profiles[0]?.id)">取消新增</UiButton>
        </div>
        <div v-if="confirmingDelete" class="rounded-xl border border-error/30 p-4 text-body-sm">
          <p>确认删除“{{ draft.name }}”？{{ editingId === ai.state.collection.activeId ? '删除后需重新选择要使用的 AI。' : '' }}</p>
          <div class="mt-3 flex gap-2"><UiButton size="sm" @click="remove">确认删除</UiButton><UiButton size="sm" variant="text" @click="confirmingDelete = false">取消删除</UiButton></div>
        </div>
      </fieldset>
      <p v-if="error" role="alert" class="text-body-sm text-error">{{ error }}</p>
      <p v-if="message" role="status" class="text-body-sm text-graphite">{{ message }}</p>
    </form>
    <p class="mt-4 text-caption leading-relaxed text-stone">AI 功能会将相关课程信息、疑问、字幕、笔记或作答发送至所选服务。视频与截图不会上传。</p>
    <UiButton v-if="ai.configured.value" class="mt-4" @click="emit('done')">返回定制路线</UiButton>
  </section>
</template>

<style scoped>
@reference '../styles/main.css';
.ai-input { @apply block w-full min-w-0 rounded-xl border border-linen bg-page-cream px-3 py-2.5 font-normal outline-none focus:border-charcoal-ink; }
</style>

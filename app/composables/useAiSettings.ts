import { onMounted, computed, reactive } from 'vue'
import { databaseRequest } from '~/utils/database'
import type { AiProfile, AiSettingsCollection, GuideSettings } from '~/types/guide'
import { emptyAiCollection, emptyAiSettings, removeAiProfile, restoreAiSettings, validateAiProfile } from '~/utils/aiSettings'
import { dbSaveSetting } from '~/utils/dbClient'

const SETTINGS_KEY = 'ai_settings'

export function useAiSettings() {
  const state = reactive({ collection: emptyAiCollection(), ready: false, loading: false, saving: false, error: '' })
  // 保持对象引用稳定：导学与课后练习共用当前配置。
  const settings = reactive<GuideSettings>(emptyAiSettings())
  const activeProfile = computed(() => state.collection.profiles.find(p => p.id === state.collection.activeId))
  const configured = computed(() => state.ready && !state.saving && !!settings.baseUrl && !!settings.model)

  function apply(collection: AiSettingsCollection) {
    state.collection = collection
    const active = collection.profiles.find(p => p.id === collection.activeId)
    Object.assign(settings, emptyAiSettings(), active ? {
      provider: active.provider ?? 'openai',
      contextWindow: active.contextWindow ?? 'default',
      baseUrl: active.baseUrl, model: active.model, apiKey: active.apiKey, timeoutMinutes: active.timeoutMinutes,
    } : {})
  }

  async function load() {
    if (state.loading || state.saving) return
    state.loading = true; state.ready = false; state.error = ''
    try {
      // 读取失败不能视为空配置，否则会覆盖已保存的密钥。
      const stored = await databaseRequest<unknown>('settings', { query: { key: SETTINGS_KEY } })
      const raw = stored
      const collection = restoreAiSettings(raw)
      if (raw != null && (raw as { version?: number }).version !== 2) {
        if (!await dbSaveSetting(SETTINGS_KEY, collection)) throw new Error('AI 配置格式升级失败，请重试。')
      }
      apply(collection)
      state.ready = true
    } catch {
      state.error = 'AI 配置读取失败，原有配置未修改。请重试。'
    } finally { state.loading = false }
  }

  async function persist(collection: AiSettingsCollection) {
    if (!state.ready || state.saving) throw new Error('AI 配置尚未就绪，请稍后重试。')
    const snapshot = restoreAiSettings(collection)
    state.saving = true
    try {
      if (!await dbSaveSetting(SETTINGS_KEY, snapshot)) throw new Error('AI 配置保存失败，请重试。')
      apply(snapshot)
    } finally { state.saving = false }
  }

  async function saveProfile(draft: GuideSettings & { name: string; modelIds?: string[] }, id?: string) {
    if (id && !state.collection.profiles.some(p => p.id === id)) throw new Error('该 AI 配置已不存在。')
    const profile = validateAiProfile(draft, id || crypto.randomUUID())
    const profiles: AiProfile[] = id ? state.collection.profiles.map(p => p.id === id ? profile : { ...p })
      : [...state.collection.profiles.map(p => ({ ...p })), profile]
    await persist({ version: 2, profiles, activeId: profile.id })
    return profile.id
  }

  async function selectProfile(id: string) {
    if (id === state.collection.activeId) return
    if (!state.collection.profiles.some(p => p.id === id)) throw new Error('请选择有效的 AI 配置。')
    await persist({ version: 2, profiles: state.collection.profiles.map(p => ({ ...p })), activeId: id })
  }

  async function deleteProfile(id: string) {
    await persist(removeAiProfile(state.collection, id))
  }

  async function selectModel(model: string) {
    const active = activeProfile.value
    if (!active || !(active.modelIds ?? [active.model]).includes(model)) throw new Error('请选择该配置中已保存的模型 ID。')
    if (model === active.model) return
    await persist({ version: 2, activeId: active.id, profiles: state.collection.profiles.map(p => ({ ...p, ...(p.id === active.id ? { model } : {}) })) })
  }

  onMounted(load)
  return { state, settings, activeProfile, configured, load, saveProfile, selectProfile, selectModel, deleteProfile }
}

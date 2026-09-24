import type { AiProfile, AiSettingsCollection, GuideSettings } from '../types/guide'
import { completionUrl } from './guideAi.ts'
import { isRecord } from './guide.ts'

export const emptyAiSettings = (): GuideSettings => ({ baseUrl: '', model: '', apiKey: '', timeoutMinutes: 15, maxTokens: 0 })
export const emptyAiCollection = (): AiSettingsCollection => ({ version: 2, profiles: [], activeId: '' })

function readSettings(value: Record<string, unknown>): GuideSettings {
  return {
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl.trim() : '',
    model: typeof value.model === 'string' ? value.model.trim() : '',
    apiKey: typeof value.apiKey === 'string' ? value.apiKey.trim() : '',
    timeoutMinutes: typeof value.timeoutMinutes === 'number' && Number.isFinite(value.timeoutMinutes)
      ? Math.min(30, Math.max(1, value.timeoutMinutes)) : 15,
    maxTokens: typeof value.maxTokens === 'number' && Number.isFinite(value.maxTokens) && value.maxTokens > 0
      ? Math.min(1_000_000, Math.max(256, Math.round(value.maxTokens))) : 0,
  }
}

/** 兼容 SQLite 中早期的单组配置格式，保留密钥与未填写完整的配置。 */
export function restoreAiSettings(value: unknown): AiSettingsCollection {
  if (value === null || value === undefined) return emptyAiCollection()
  if (!isRecord(value)) throw new Error('AI 配置格式异常，请检查本地配置。')
  if (!('version' in value) && ('baseUrl' in value || 'model' in value)) {
    const settings = readSettings(value)
    const profile = { ...settings, id: 'legacy-default', name: '原有配置' }
    return { version: 2, profiles: [profile], activeId: profile.id }
  }
  if (value.version !== 2 || !Array.isArray(value.profiles) || typeof value.activeId !== 'string') {
    throw new Error('AI 配置格式异常，请检查本地配置。')
  }
  const ids = new Set<string>()
  const profiles = value.profiles.map((item): AiProfile => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)
      || typeof item.name !== 'string' || !item.name.trim()
      || typeof item.baseUrl !== 'string' || typeof item.model !== 'string' || typeof item.apiKey !== 'string') {
      throw new Error('AI 配置列表异常，请检查本地配置。')
    }
    ids.add(item.id)
    return { ...readSettings(item), id: item.id, name: item.name }
  })
  if (value.activeId && !ids.has(value.activeId)) throw new Error('当前 AI 配置不存在，请检查本地配置。')
  return { version: 2, profiles, activeId: value.activeId }
}

export function validateAiProfile(value: GuideSettings & { name: string }, id: string): AiProfile {
  const name = value.name.trim()
  if (!name || name.length > 60) throw new Error('请填写 1–60 字的配置名称。')
  const settings = readSettings(value as unknown as Record<string, unknown>)
  completionUrl(settings.baseUrl)
  if (!settings.model) throw new Error('请填写模型名称。')
  return { ...settings, id, name }
}

export function removeAiProfile(collection: AiSettingsCollection, id: string): AiSettingsCollection {
  return { version: 2, profiles: collection.profiles.filter(p => p.id !== id), activeId: collection.activeId === id ? '' : collection.activeId }
}

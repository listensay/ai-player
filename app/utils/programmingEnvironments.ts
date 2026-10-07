import { reactive } from 'vue'
import { desktopInvoke, isDesktop } from './platform.ts'
import { isRecord } from './guide.ts'
import { isProgrammingLanguage } from './programmingLanguages.ts'
import type { ProgrammingLanguage } from './programmingLanguages.ts'

export interface ProgrammingEnvironment {
  id: string
  name: string
  languages: ProgrammingLanguage[]
  executable: string
  directory: string
  version: string
}
export interface ProgrammingInventory {
  environments: ProgrammingEnvironment[]
  searchDirectories: string[]
  workingDirectory: string
}
export const programmingEnvironments = reactive({
  inventory: null as ProgrammingInventory | null,
  extraDirectories: [] as string[],
  loading: false,
  error: '',
})
let pending: Promise<ProgrammingInventory> | undefined
let updatedAt = 0
function validateInventory(raw: unknown): ProgrammingInventory {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.environments) ||
    !Array.isArray(raw.searchDirectories) ||
    !raw.searchDirectories.every((p) => typeof p === 'string') ||
    typeof raw.workingDirectory !== 'string'
  )
    throw new Error('编程环境检测结果无效。')
  const environments = raw.environments.map((item) => {
    if (
      !isRecord(item) ||
      !['id', 'name', 'executable', 'directory', 'version'].every((key) => typeof item[key] === 'string') ||
      !Array.isArray(item.languages) ||
      !item.languages.length ||
      !item.languages.every(isProgrammingLanguage)
    )
      throw new Error('编程环境信息无效。')
    return item as unknown as ProgrammingEnvironment
  })
  return { environments, searchDirectories: raw.searchDirectories, workingDirectory: raw.workingDirectory }
}
async function setting(method: 'GET' | 'POST', value?: string[]) {
  return desktopInvoke<unknown>('database_request', {
    endpoint: 'settings',
    method,
    query: { key: 'programming-environment-directories' },
    body: method === 'POST' ? { key: 'programming-environment-directories', value } : {},
  })
}
export function loadProgrammingEnvironments(force = false): Promise<ProgrammingInventory> {
  if (!isDesktop()) {
    const error = new Error('请在桌面应用中检测本机编程环境。')
    programmingEnvironments.error = error.message
    return Promise.reject(error)
  }
  if (pending) return pending
  if (!force && programmingEnvironments.inventory && Date.now() - updatedAt < 60_000)
    return Promise.resolve(programmingEnvironments.inventory)
  programmingEnvironments.loading = true
  programmingEnvironments.error = ''
  pending = (async () => {
    try {
      const saved = await setting('GET')
      if (saved !== null && (!Array.isArray(saved) || !saved.every((p) => typeof p === 'string') || saved.length > 32))
        throw new Error('环境目录设置无效。')
      programmingEnvironments.extraDirectories = saved ?? []
      const result = validateInventory(
        await desktopInvoke('programming_environments', {
          extraDirectories: programmingEnvironments.extraDirectories,
        }),
      )
      programmingEnvironments.inventory = result
      updatedAt = Date.now()
      return result
    } catch (error) {
      programmingEnvironments.inventory = null
      programmingEnvironments.error = error instanceof Error ? error.message : '编程环境检测失败。'
      throw error
    } finally {
      programmingEnvironments.loading = false
      pending = undefined
    }
  })()
  return pending
}
export async function setProgrammingDirectories(directories: string[]) {
  if (directories.length > 32) throw new Error('最多添加 32 个环境目录。')
  await setting('POST', directories)
  programmingEnvironments.extraDirectories = directories
  updatedAt = 0
  return loadProgrammingEnvironments(true)
}
export async function availableProgrammingLanguages(): Promise<ProgrammingLanguage[]> {
  // The browser preview retains its embedded JS runner; desktop availability is always detected.
  if (!isDesktop()) return ['javascript']
  const inventory = await loadProgrammingEnvironments()
  return [...new Set(inventory.environments.flatMap((item) => item.languages))]
}

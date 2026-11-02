import type { GuideRouteConstraints } from '../types/guideConstraints'
import type { GuideCourseCatalogEntry } from '../types/guideConversation'
import type { LearningPlan } from '../types/guide'
import { budgetForDay, budgetTotal, stageForDay } from './studyProgram.ts'

export const emptyRouteConstraints = (): GuideRouteConstraints => ({
  version: 1,
  order: 'ai',
  orderExplicit: false,
  excludedFolders: [],
  includedFolders: null,
  includeRemaining: false,
  weeklyMinutes: null,
})

export function parseRouteConstraints(raw: unknown): GuideRouteConstraints {
  if (raw == null) return emptyRouteConstraints()
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('学习范围记录无效，请重试。')
  const value = raw as Record<string, unknown>
  const folders = (input: unknown) => {
    if (
      !Array.isArray(input) ||
      input.length > 2000 ||
      input.some(
        (path) =>
          typeof path !== 'string' ||
          !path ||
          path.length > 2000 ||
          path.split('/').some((part) => !part || part === '.' || part === '..') ||
          path.includes('\\'),
      )
    )
      throw new Error('学习目录记录无效，请重试。')
    return [...new Set(input as string[])]
  }
  if (
    value.version !== 1 ||
    !['ai', 'catalog'].includes(String(value.order)) ||
    typeof value.includeRemaining !== 'boolean' ||
    (value.orderExplicit !== undefined && typeof value.orderExplicit !== 'boolean')
  )
    throw new Error('学习范围记录无效，请重试。')
  let weeklyMinutes: GuideRouteConstraints['weeklyMinutes'] = null
  if (value.weeklyMinutes != null) {
    const weekly = value.weeklyMinutes as Record<string, unknown>
    if (
      typeof weekly !== 'object' ||
      Array.isArray(weekly) ||
      !Number.isInteger(weekly.min) ||
      Number(weekly.min) < 0 ||
      Number(weekly.min) > 10080 ||
      (weekly.max !== null &&
        (!Number.isInteger(weekly.max) || Number(weekly.max) < Number(weekly.min) || Number(weekly.max) > 10080))
    )
      throw new Error('学习时间记录无效，请重试。')
    weeklyMinutes = { min: Number(weekly.min), max: weekly.max === null ? null : Number(weekly.max) }
  }
  return {
    version: 1,
    order: value.order as 'ai' | 'catalog',
    orderExplicit: value.orderExplicit === true,
    excludedFolders: folders(value.excludedFolders),
    includedFolders: value.includedFolders === null ? null : folders(value.includedFolders),
    includeRemaining: value.includeRemaining,
    weeklyMinutes,
  }
}

const normalized = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s._-]+/g, '')
export function catalogFolders(catalog: Array<{ path: string }>): string[] {
  const folders = new Set<string>()
  for (const entry of catalog) {
    const parts = entry.path.split('/').slice(0, -1)
    for (let length = 1; length <= parts.length; length++) folders.add(parts.slice(0, length).join('/'))
  }
  return [...folders]
}
export function pathInScope(path: string, constraints: GuideRouteConstraints): boolean {
  const inside = (folder: string) => path.startsWith(folder + '/')
  return (
    !constraints.excludedFolders.some(inside) &&
    (constraints.includedFolders === null || constraints.includedFolders.some(inside))
  )
}
export function hasRouteSelection(constraints: GuideRouteConstraints): boolean {
  return constraints.includeRemaining || constraints.includedFolders !== null || constraints.excludedFolders.length > 0
}
export const fixedCatalogRoute = (constraints: GuideRouteConstraints) =>
  constraints.order === 'catalog' && constraints.includeRemaining

export const excludedRoutePaths = (plan: LearningPlan) =>
  new Set(
    plan.constraints
      ? plan.lessons.filter((lesson) => !pathInScope(lesson.path, plan.constraints!)).map((lesson) => lesson.path)
      : [],
  )

/** Recognize explicit directory/order commands, never infer exclusions from a learner's skill level. */
export function readRouteDirective(
  previous: GuideRouteConstraints,
  input: string,
  catalog: Array<{ path: string }>,
): { constraints: GuideRouteConstraints; explicit: boolean; timeExplicit: boolean } {
  const constraints = parseRouteConstraints(previous)
  const text = input.normalize('NFKC')
  const folders = catalogFolders(catalog)
  const roots = folders.filter((folder) => !folder.includes('/'))
  const labels = new Map<string, number>()
  for (const folder of folders) {
    const label = normalized(folder.split('/').at(-1)!)
    labels.set(label, (labels.get(label) ?? 0) + 1)
  }
  const numbered = new Map<string, string[]>()
  for (const folder of roots) {
    const number = folder.match(/^(?:第)?(\d+)/)?.[1]
    if (number) numbered.set(String(Number(number)), [...(numbered.get(String(Number(number))) ?? []), folder])
  }
  function references(fragment: string): string[] {
    const matches = new Set<string>()
    const compact = normalized(fragment)
    const contains = (needle: string) => {
      let index = compact.indexOf(needle)
      while (index >= 0) {
        if (index === 0 || !/^\d/.test(needle) || !/\d/.test(compact[index - 1]!)) return true
        index = compact.indexOf(needle, index + 1)
      }
      return false
    }
    for (const folder of folders) {
      const full = normalized(folder)
      const label = normalized(folder.split('/').at(-1)!)
      if (/^\d+$/.test(label)) continue
      if (contains(full) || (labels.get(label) === 1 && contains(label))) matches.add(folder)
    }
    // Bare chapter numbers refer only to uniquely numbered top-level directories.
    const list = fragment.match(
      /^\s*((?:第)?\d+(?:(?:[、，,\s]|和|及|与)+(?:第)?\d+)*)(?=$|的?(?:目录|章节|章)|[和及与、，,\s])/,
    )
    for (const match of (list?.[1] ?? '').matchAll(/\d+/g)) {
      const choices = numbered.get(String(Number(match[0])))
      if (choices?.length === 1) matches.add(choices[0]!)
    }
    // A numbered title may abbreviate its source name, but must still match that directory's title.
    for (const match of fragment.matchAll(/(?:^|[、，,])\s*(?:第)?(\d+)[\s._-]*([^、，,\n/]+)/g)) {
      const choices = numbered.get(String(Number(match[1])))
      const title = normalized(match[2]!).replace(/(?:的)?(?:目录|章节)$/, '')
      if (choices?.length === 1 && title.length >= 2 && normalized(choices[0]!).replace(/^\d+/, '').includes(title))
        matches.add(choices[0]!)
    }
    return [...matches].filter((folder) => ![...matches].some((other) => other.startsWith(folder + '/')))
  }
  let explicit = false
  let timeExplicit = false
  for (const line of text.split('\n')) {
    if (!/每周|每星期/.test(line) || /^(?:如果|假如|假设)/.test(line.trim())) continue
    const answer = line.includes('：') || line.includes(':') ? line.split(/[:：]/).slice(1).join('：') : line
    const match = answer.match(/(\d+(?:\.\d+)?)(?:\s*[–—~～-]\s*(\d+(?:\.\d+)?))?\s*(?:个)?(?:小时|h\b)/i)
    if (match) {
      if (/每天|每日|每晚/.test(answer.slice(0, match.index))) continue
      const min = Math.round(Number(match[1]) * 60)
      const max = /以上|至少|不少于/.test(answer) ? null : Math.round(Number(match[2] ?? match[1]) * 60)
      if (min <= 10080 && (max === null || (max >= min && max <= 10080))) {
        constraints.weeklyMinutes = { min: /以内|以下|最多|不超过/.test(answer) && !match[2] ? 0 : min, max }
        explicit = true
        timeExplicit = true
      }
    } else if (/不确定|暂不确定|按建议|帮我建议/.test(answer)) {
      constraints.weeklyMinutes = null
      explicit = true
      timeExplicit = true
    }
  }
  const addExclusions = (values: string[]) => {
    if (!values.length) return
    constraints.excludedFolders = [...new Set([...constraints.excludedFolders, ...values])]
    explicit = true
  }
  // Only the user-authored directive spans are inspected; questionnaire labels and AI suggestions are not policies.
  const exclusion =
    /(?<!不是|并非|不要|不能|别)(?:不需要学|不想学|不学习|不学|跳过|排除)(?:的)?(?:章节|目录|课程|课节|部分)?\s*[:：]?/g
  for (const match of text.matchAll(exclusion)) {
    const before = text
      .slice(Math.max(0, match.index! - 24), match.index!)
      .split(/[\n。；;!?！？]/)
      .at(-1)!
    if (/(?:如果|假如|假设|是否|要不要|能不能)[^，,]*$/.test(before)) continue
    const after = text.slice(match.index! + match[0].length)
    const fragment = after.split(/剩下|剩余|其余|其他|但是|不过|但|[。；;!?！？]/, 1)[0]!
    if (/会(?:不会|影响)|是否|能不能|可以吗|合适吗/.test(fragment)) continue
    const lines = fragment.split('\n')
    const values: string[] = []
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue
      const found = references(line)
      if (index > 0 && !found.length) break
      values.push(...found)
    }
    addExclusions(values)
  }
  for (const line of text.split(/[\n。；;!?！？]/)) {
    const trailing = line.match(/(.+?)(?:的)?(?:目录|章节|课(?:节|程)?)?\s*(?:不学|不学习|不需要学|不要学|跳过)\s*$/)
    if (trailing && !/(?:不是|并非|不要|不能|别)\s*$/.test(trailing[1]!)) addExclusions(references(trailing[1]!))
    if (/是否|是不是|要不要|如果|假如|会不会|能不能/.test(line)) continue
    const only = line.match(/(?:只学习|只学|仅学习|仅学|只保留)\s*(?:目录|章节)?\s*(.+)/)
    if (only) {
      const values = references(only[1]!)
      if (values.length) {
        constraints.includedFolders = values
        constraints.excludedFolders = constraints.excludedFolders.filter((folder) => !values.includes(folder))
        constraints.includeRemaining = true
        explicit = true
      }
    }
    const restored =
      line.match(/(?:恢复学习|重新学|重新加入|也要学|也学|不再跳过|不要跳过|不跳过)\s*(.+)/) ??
      line.match(/(.+?)\s*(?:也要学|也学|恢复学习|不用跳过|不要跳过)\s*$/)
    if (restored) {
      const values = references(restored[1]!)
      if (values.length) {
        constraints.excludedFolders = constraints.excludedFolders.filter((folder) => !values.includes(folder))
        if (constraints.includedFolders)
          constraints.includedFolders = [...new Set([...constraints.includedFolders, ...values])]
        explicit = true
      }
    }
  }
  const range = text.match(/从\s*(\d+)(?![\d月年])[^\n。；;]{0,12}?[到道至]\s*(\d+)(?![\d月年])/)
  if (range && /学习(?:路线|范围)|目录|章节|开始学/.test(text)) {
    const start = Number(range[1]),
      end = Number(range[2])
    if (start <= end && numbered.get(String(start))?.length === 1 && numbered.get(String(end))?.length === 1) {
      constraints.includedFolders = roots.filter((folder) => {
        const number = Number(folder.match(/^(?:第)?(\d+)/)?.[1])
        return number >= start && number <= end
      })
      constraints.excludedFolders = constraints.excludedFolders.filter(
        (folder) => !constraints.includedFolders!.includes(folder),
      )
      constraints.includeRemaining = true
      explicit = true
    }
  }
  const statements = text
    .split(/[\n。；;!?！？]/)
    .filter((line) => !/如果|假如|假设|是否|是不是|要不要|能不能|会不会|可以吗|合适吗/.test(line))
    .join('\n')
  if (
    /(?<!不是|并非|不要|不|别)(?:剩下|剩余|其余|其他)(?:的|部分|章节|目录|内容|课节|课程)?[\s，,]*(?:(?:都(?:是|要)?|全部|全都|一律)(?:要)?学|(?:直接)?按(?:照)?[^。\n]{0,8}顺序)/.test(
      statements,
    )
  ) {
    constraints.includeRemaining = true
    explicit = true
  }
  if (
    /(?<!不是|并非|不要|不|别)(?:全部|所有)(?:目录|章节|课节|课程)(?:都)?(?:要学|学习)|取消所有排除/.test(statements) &&
    !/除了|除去/.test(statements)
  ) {
    constraints.excludedFolders = []
    constraints.includedFolders = null
    constraints.includeRemaining = true
    explicit = true
  }
  const catalogOrder =
    [
      ...text.matchAll(
        /(?<!不要|不|别)按(?:照)?\s*(?:原(?:来|有|始)?(?:的)?|目录(?:原(?:来|有|始))?(?:的)?)?顺序|(?:不要|别|不|无需)(?:再)?(?:改(?:变)?|调整|重排|优化)(?:学习)?顺序/g,
      ),
    ].at(-1)?.index ?? -1
  const aiOrder =
    [
      ...text.matchAll(/(?<!不要|不再|无需|不用|不|别)(?:重新安排|优化|调整|重排)(?:学习)?顺序|让\s*AI\s*安排顺序/gi),
    ].at(-1)?.index ?? -1
  if (catalogOrder >= 0 && catalogOrder >= aiOrder) {
    constraints.order = 'catalog'
    constraints.orderExplicit = true
    explicit = true
  } else if (aiOrder >= 0) {
    constraints.order = 'ai'
    constraints.orderExplicit = true
    explicit = true
  }
  if (constraints.includeRemaining && !constraints.orderExplicit) constraints.order = 'catalog'
  const folderOrder = new Map(folders.map((folder, index) => [folder, index]))
  constraints.excludedFolders.sort((a, b) => (folderOrder.get(a) ?? -1) - (folderOrder.get(b) ?? -1))
  return { constraints, explicit, timeExplicit }
}

export function constrainLearningPlan(
  plan: LearningPlan,
  raw: GuideRouteConstraints,
  catalog: Array<{ path: string }>,
): LearningPlan {
  const constraints = parseRouteConstraints(raw)
  const folders = new Set(catalogFolders(catalog))
  if ([...constraints.excludedFolders, ...(constraints.includedFolders ?? [])].some((folder) => !folders.has(folder)))
    throw new Error('课程目录已变化，请重新选择学习范围。')
  for (const lesson of plan.lessons) {
    if (!pathInScope(lesson.path, constraints)) {
      lesson.status = 'skipped'
      lesson.reason = '按你的选择跳过。'
    } else if (constraints.includeRemaining) {
      lesson.status = 'required'
      lesson.reason = '按你的学习范围安排。'
    }
  }
  if (constraints.order === 'catalog') {
    const indices = new Map(catalog.map((lesson, index) => [lesson.path, index]))
    plan.lessons.sort((a, b) => indices.get(a.path)! - indices.get(b.path)!)
    const moduleOrder = new Map<string, number>()
    for (const [index, lesson] of plan.lessons.entries())
      if (lesson.status !== 'skipped' && !moduleOrder.has(lesson.moduleId)) moduleOrder.set(lesson.moduleId, index)
    plan.modules.sort((a, b) => (moduleOrder.get(a.id) ?? Infinity) - (moduleOrder.get(b.id) ?? Infinity))
  }
  if (hasRouteSelection(constraints))
    for (const module of plan.modules)
      if (!plan.lessons.some((lesson) => lesson.moduleId === module.id && lesson.status !== 'skipped'))
        delete module.practice
  plan.constraints = constraints
  if (fixedCatalogRoute(constraints)) plan.summary = '按原目录顺序学习已选择的课程。'
  return plan
}

export function routeArrangement(constraints: GuideRouteConstraints, catalog: GuideCourseCatalogEntry[]) {
  if (!hasRouteSelection(constraints) && constraints.order !== 'catalog') return []
  const selected = catalog.filter((lesson) => pathInScope(lesson.path, constraints))
  const roots = [...new Set(selected.map((lesson) => lesson.path.split('/').slice(0, -1)[0]).filter(Boolean))]
  const rows = [{ label: '学习范围', value: selected.length ? roots.join(' → ') || '当前课程' : '暂无可学习课节' }]
  if (constraints.excludedFolders.length) rows.push({ label: '跳过', value: constraints.excludedFolders.join('、') })
  if (constraints.order === 'catalog') {
    const next = selected.find((lesson) => !lesson.done)
    if (next) rows.push({ label: '接着学习', value: next.title })
  }
  if (constraints.weeklyMinutes) {
    const { min, max } = constraints.weeklyMinutes
    const value =
      max === null
        ? `${min / 60} 小时以上`
        : min === 0
          ? `${max / 60} 小时以内`
          : min === max
            ? `${max / 60} 小时`
            : `${min / 60}–${max / 60} 小时`
    rows.push({ label: '每周投入', value })
  }
  return rows
}

export function validatePlanTimeConstraints(plan: LearningPlan) {
  const max = plan.constraints?.weeklyMinutes?.max
  if (max == null) return
  if (!plan.program) {
    if (plan.dailyMinutes * 7 > max) throw new Error('学习时间超出你设定的上限，请重试。')
    return
  }
  const minutes: number[] = []
  let total = 0
  for (let day = 1; day <= plan.program.days; day++) {
    const stage = stageForDay(plan.modules, day)?.practice
    const amount = budgetTotal(budgetForDay(plan.program, stage, day))
    minutes.push(amount)
    total += amount - (minutes[day - 8] ?? 0)
    if (total > max) throw new Error('学习时间超出你设定的上限，请重试。')
  }
}

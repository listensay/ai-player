import type { DependencyRisk, GuideLesson, KnowledgeModule } from '../types/guide'

/** 拆分展示关系；不修改前置图、选课状态或风险统计。 */
export function dependencyOverview(lessons: GuideLesson[], modules: KnowledgeModule[], risks: DependencyRisk[]) {
  const byPath = new Map(lessons.map(lesson => [lesson.path, lesson]))
  const missing = new Set(risks.map(risk => risk.prerequisite))
  const reverse = new Map<string, Set<string>>()
  for (const lesson of lessons) for (const prerequisite of lesson.prerequisites) {
    if (!reverse.has(prerequisite)) reverse.set(prerequisite, new Set())
    reverse.get(prerequisite)!.add(lesson.path)
  }
  const moduleOrder = new Map(modules.map((module, index) => [module.id, index]))
  const lessonOrder = new Map(lessons.map((lesson, index) => [lesson.path, index]))
  return risks.map(risk => {
    const affected = new Set(risk.dependents)
    // 直接关系也可能先经过一节尚未加入路线的课，不能把它伪装成直接依赖某节远端课。
    const direct = [...(reverse.get(risk.prerequisite) ?? [])].filter(path => affected.has(path) || missing.has(path))
    const directlyAffected = new Set(direct)
    return { prerequisite: risk.prerequisite, moduleId: byPath.get(risk.prerequisite)?.moduleId ?? '', direct,
      indirect: [...affected].filter(path => !directlyAffected.has(path)), affectedCount: affected.size }
  }).sort((a, b) => (moduleOrder.get(a.moduleId) ?? modules.length) - (moduleOrder.get(b.moduleId) ?? modules.length)
    || (lessonOrder.get(a.prerequisite) ?? lessons.length) - (lessonOrder.get(b.prerequisite) ?? lessons.length))
}

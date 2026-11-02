import type { Course, FolderEntry, VideoEntry } from '../types/course'
import type { KnowledgeModule, LearningPlan } from '../types/guide'

export const lessonDirectory = (path: string) => path.split('/').slice(0, -1).join('/')

export function catalogModules(catalog: Array<{ path: string }>, courseName: string): KnowledgeModule[] {
  const folders = [...new Set(catalog.map((entry) => lessonDirectory(entry.path)))]
  const ids = new Set<string>()
  return folders.map((sourcePath) => {
    let hash = 2166136261
    for (const char of sourcePath) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0
    const id = `directory-${hash.toString(36)}`
    if (ids.has(id)) throw new Error('课程目录编号冲突，请重新打开课程。')
    ids.add(id)
    return { id, sourcePath, title: sourcePath.split('/').at(-1) || courseName, description: '按原课程目录学习。' }
  })
}

/** File paths determine lesson ownership. AI topic names never become course directories. */
export function bindPlanCatalog(
  plan: LearningPlan,
  catalog: Array<{ path: string }>,
  courseName: string,
): LearningPlan {
  const paths = new Set(catalog.map((entry) => entry.path))
  if (
    paths.size !== catalog.length ||
    plan.lessons.length !== paths.size ||
    new Set(plan.lessons.map((entry) => entry.path)).size !== paths.size ||
    plan.lessons.some((entry) => !paths.has(entry.path))
  )
    throw new Error('学习路线与课程目录不完整对应，请重新生成。')
  const modules = catalogModules(catalog, courseName)
  const oldModules = new Map(plan.modules.map((module) => [module.id, module]))
  const oldOwners = new Map<string, Set<string>>()
  for (const lesson of plan.lessons) {
    if (!oldOwners.has(lesson.moduleId)) oldOwners.set(lesson.moduleId, new Set())
    oldOwners.get(lesson.moduleId)!.add(lessonDirectory(lesson.path))
  }
  for (const module of modules) {
    const previous =
      plan.modules.find((old) => old.sourcePath === module.sourcePath) ??
      plan.modules.find((old) => oldOwners.get(old.id)?.size === 1 && oldOwners.get(old.id)?.has(module.sourcePath!))
    if (previous && oldOwners.get(previous.id)?.size === 1) {
      module.id = previous.id
      if (previous.practice) module.practice = previous.practice
    }
  }
  if (new Set(modules.map((module) => module.id)).size !== modules.length)
    throw new Error('学习目录编号冲突，请重新生成。')
  const byFolder = new Map(modules.map((module) => [module.sourcePath, module.id]))
  const lessons = plan.lessons.map((lesson) => {
    if (!oldModules.has(lesson.moduleId)) throw new Error('课节的学习目录无效，请重新生成。')
    return { ...lesson, moduleId: byFolder.get(lessonDirectory(lesson.path))! }
  })
  return { ...plan, catalogVersion: 1, modules, lessons }
}

/** Keep each original subtree intact, using proposed route positions only to order siblings. */
export function catalogRouteTree(root: FolderEntry, videos: VideoEntry[]): FolderEntry {
  const positions = new Map(videos.map((video, index) => [video.path, index]))
  if (positions.size !== videos.length) throw new Error('学习路线包含重复课节。')
  const seen = new Set<string>()
  function visit(folder: FolderEntry): { folder: FolderEntry; rank: number } {
    const nodes: Array<{ node: FolderEntry | VideoEntry; rank: number }> = []
    for (const node of folder.children) {
      if (node.kind === 'folder') {
        const child = visit(node)
        if (child.folder.videoCount) nodes.push({ node: child.folder, rank: child.rank })
      } else if (positions.has(node.path)) {
        if (seen.has(node.path)) throw new Error('课程目录包含重复课节。')
        seen.add(node.path)
        nodes.push({ node, rank: positions.get(node.path)! })
      }
    }
    nodes.sort((a, b) => a.rank - b.rank)
    const children = nodes.map((item) => item.node)
    return {
      folder: {
        ...folder,
        children,
        videoCount: children.reduce((count, node) => count + (node.kind === 'folder' ? node.videoCount : 1), 0),
      },
      rank: nodes[0]?.rank ?? Infinity,
    }
  }
  const tree = visit(root).folder
  if (seen.size !== positions.size) throw new Error('学习路线与课程目录不一致，请重新打开课程。')
  return tree
}

export function catalogTreeVideos(root: FolderEntry): VideoEntry[] {
  return root.children.flatMap((entry) => (entry.kind === 'folder' ? catalogTreeVideos(entry) : [entry]))
}

export function numberedRouteTitle(name: string, position: number): string {
  const original = name.replace(/^(?:\d{1,4}(?:[._]\d{1,4})*[\s._\-—–、:：]+|\d{1,3}(?=[\u3400-\u9fff]))(?=\S)/u, '')
  return `${position}. ${original}`
}

export function catalogRouteLabels(root: FolderEntry, positions: Map<string, number>): Map<string, string> {
  const labels = new Map<string, string>()
  function visit(folder: FolderEntry) {
    let number = 0
    for (const entry of folder.children) {
      if (entry.kind === 'folder') {
        labels.set(entry.path, numberedRouteTitle(entry.name, ++number))
        visit(entry)
      } else labels.set(entry.path, numberedRouteTitle(entry.title, positions.get(entry.path)!))
    }
  }
  visit(root)
  return labels
}

export function orderPlanByCatalogTree(plan: LearningPlan, course: Pick<Course, 'root' | 'videos'>) {
  const byPath = new Map(plan.lessons.map((lesson) => [lesson.path, lesson]))
  const videos = new Map(course.videos.map((video) => [video.path, video]))
  const proposed = plan.lessons.map((lesson) => {
    const video = videos.get(lesson.path)
    if (!video) throw new Error('学习路线引用了不存在的课节。')
    return video
  })
  plan.lessons = catalogTreeVideos(catalogRouteTree(course.root, proposed)).map((video) => byPath.get(video.path)!)
}

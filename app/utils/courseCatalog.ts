import type { FolderEntry, VideoEntry, VideoProgress } from '../types/course'

export interface CatalogFolder extends Omit<FolderEntry, 'children'> {
  children: Array<CatalogFolder | VideoEntry>
  done: number
}

/** Keep the scanned folder order and ancestors of matching lessons. */
export function filterCourseCatalog(
  root: FolderEntry,
  paths: Set<string>,
  progress: Record<string, VideoProgress>,
): CatalogFolder {
  const children: CatalogFolder['children'] = []
  let videoCount = 0,
    done = 0
  for (const child of root.children) {
    if (child.kind === 'folder') {
      const folder = filterCourseCatalog(child, paths, progress)
      if (!folder.videoCount) continue
      children.push(folder)
      videoCount += folder.videoCount
      done += folder.done
    } else if (paths.has(child.path)) {
      children.push(child)
      videoCount++
      if (progress[child.path]?.done) done++
    }
  }
  return { ...root, children, videoCount, done }
}

export function catalogFolderPaths(root: CatalogFolder): string[] {
  return root.children.flatMap((child) => (child.kind === 'folder' ? [child.path, ...catalogFolderPaths(child)] : []))
}

/** Each ancestor has its own page, so revealing a lesson never loses its folder context. */
export function catalogLocation(
  root: CatalogFolder,
  path: string,
  pageSize: number,
): Array<{ folder: string; page: number }> | null {
  for (const [index, child] of root.children.entries()) {
    const current = { folder: root.path, page: Math.floor(index / pageSize) + 1 }
    if (child.kind === 'video' && child.path === path) return [current]
    if (child.kind === 'folder' && path.startsWith(`${child.path}/`)) {
      const nested = catalogLocation(child, path, pageSize)
      if (nested) return [current, ...nested]
    }
  }
  return null
}

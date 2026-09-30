import type { FolderEntry, VideoEntry } from '../types/course'
export interface CourseEntryRow {
  kind: 'entry'
  key: string
  node: FolderEntry | VideoEntry
  depth: number
}

/** Flatten only expanded folders so virtualization never mounts an entire subtree. */
export function courseTreeRows(root: FolderEntry, expanded: Set<string>): CourseEntryRow[] {
  const rows: CourseEntryRow[] = []
  function visit(folder: FolderEntry, depth: number) {
    for (const node of folder.children) {
      rows.push({ kind: 'entry', key: node.path, node, depth })
      if (node.kind === 'folder' && expanded.has(node.path)) visit(node, depth + 1)
    }
  }
  visit(root, 0)
  return rows
}

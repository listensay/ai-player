import type { CourseDirectoryHandle } from '~/types/storage'
import { markRaw } from 'vue'
import type { FolderEntry, VideoEntry } from '~/types/course'

/** 视频播放器支持的容器格式；mkv/mov 取决于编码器，播不了时播放器会给出提示 */
export const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'mov',
  'ogv',
  'ogg',
  'avi',
  'flv',
  'wmv',
  'ts',
  'mpg',
  'mpeg',
])

/** 忽略的目录：隐藏目录、截图资源目录、依赖目录 */
const IGNORED_DIRS = new Set(['node_modules', '.git', '.DS_Store'])

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

export function stripExtension(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? name : name.slice(0, i)
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.has(fileExtension(name))
}

/** 中文环境下的自然排序："2.mp4" 排在 "10.mp4" 前面 */
export const naturalCollator = new Intl.Collator(['zh-Hans-CN', 'en'], {
  numeric: true,
  sensitivity: 'base',
})

export function naturalCompare(a: string, b: string): number {
  return naturalCollator.compare(a, b)
}

/**
 * 递归扫描课程目录，得到树与扁平视频列表。
 * 目录和文件都按自然顺序排序；目录排在文件前面。
 * 所有句柄都用 markRaw 标记，避免被 Vue 的响应式代理包裹（文件操作需要真实的 this）。
 */
export async function scanCourse(
  root: CourseDirectoryHandle,
): Promise<{ tree: FolderEntry; videos: VideoEntry[] }> {
  const videos: VideoEntry[] = []

  async function walk(dir: CourseDirectoryHandle, path: string): Promise<FolderEntry> {
    const folders: FolderEntry[] = []
    const files: VideoEntry[] = []
    const subdirs: CourseDirectoryHandle[] = []
    const rawDir = markRaw(dir)

    for await (const entry of dir.values()) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
      if (entry.kind === 'directory') {
        // "xxx.assets" 是笔记截图目录，不当作章节
        if (entry.name.endsWith('.assets')) continue
        subdirs.push(entry)
      } else if (isVideoFile(entry.name)) {
        files.push({
          kind: 'video',
          name: entry.name,
          title: stripExtension(entry.name),
          path: path ? `${path}/${entry.name}` : entry.name,
          dir: path,
          index: -1,
          handle: markRaw(entry),
          parent: rawDir,
        })
      }
    }

    subdirs.sort((a, b) => naturalCompare(a.name, b.name))
    for (const sub of subdirs) {
      const folder = await walk(sub, path ? `${path}/${sub.name}` : sub.name)
      if (folder.videoCount > 0) folders.push(folder)
    }
    files.sort((a, b) => naturalCompare(a.name, b.name))

    // 先目录后文件，保持“章节 -> 课时”的阅读顺序；先递归再收集，保证扁平列表顺序正确
    const children: Array<FolderEntry | VideoEntry> = [...folders, ...files]
    const videoCount = folders.reduce((n, f) => n + f.videoCount, 0) + files.length

    return { kind: 'folder', name: dir.name, path, handle: rawDir, children, videoCount }
  }

  const tree = await walk(root, '')

  // 扁平列表按树的深度优先顺序编号
  const flatten = (folder: FolderEntry) => {
    for (const child of folder.children) {
      if (child.kind === 'folder') flatten(child)
      else {
        child.index = videos.length
        videos.push(child)
      }
    }
  }
  flatten(tree)

  return { tree, videos }
}

export async function readTextFile(
  dir: CourseDirectoryHandle,
  name: string,
): Promise<string | null> {
  try {
    const handle = await dir.getFileHandle(name)
    const file = await handle.getFile()
    return await file.text()
  } catch (err) {
    if ((err as DOMException).name === 'NotFoundError') return null
    throw err
  }
}

export async function writeTextFile(
  dir: CourseDirectoryHandle,
  name: string,
  text: string,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
}

export async function writeBlobFile(
  dir: CourseDirectoryHandle,
  name: string,
  blob: Blob,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

/** 按相对路径（可含多级目录）读取文件；不存在返回 null */
export async function resolveRelativeFile(
  base: CourseDirectoryHandle,
  relativePath: string,
): Promise<File | null> {
  const parts = relativePath.split('/').filter((p) => p && p !== '.')
  if (parts.length === 0) return null
  try {
    let dir = base
    for (const part of parts.slice(0, -1)) {
      if (part === '..') return null
      dir = await dir.getDirectoryHandle(part)
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]!)
    return await fileHandle.getFile()
  } catch {
    return null
  }
}

/** 相对路径是否是可以直接交给 <img> 的绝对地址 */
export function isAbsoluteUrl(src: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)
}

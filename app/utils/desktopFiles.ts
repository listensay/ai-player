import type { CourseDirectoryHandle, CourseFileHandle, CourseHandle } from '../types/storage'
import { desktopInvoke } from './platform.ts'

interface NativeEntry { name: string; kind: 'directory' | 'file'; relative: string; size: number; modified: number; path: string }

class NativeHandle implements CourseHandle {
  readonly root: string
  readonly relative: string
  readonly name: string
  readonly kind: 'directory' | 'file'
  constructor(root: string, relative: string, name: string, kind: 'directory' | 'file') {
    this.root = root; this.relative = relative; this.name = name; this.kind = kind
  }
  async isSameEntry(other: CourseHandle) {
    if (!(other instanceof NativeHandle)) return false
    // 由 Rust 端解析规范路径，保证别名与路径分隔符一致。
    return (await this.stat()).path === (await other.stat()).path
  }
  async isAvailable() {
    try { await this.stat(); return true } catch { return false }
  }
  stat() { return desktopInvoke<NativeEntry>('fs_stat', { root: this.root, relative: this.relative }) }
  childPath(name: string) {
    if (!name || name === '.' || name === '..' || /[/\\]/.test(name)) throw new Error('无效的文件名')
    return this.relative ? `${this.relative}/${name}` : name
  }
}
class NativeFile extends NativeHandle implements CourseFileHandle {
  override readonly kind = 'file' as const
  async getFile(): Promise<File> {
    const info = await this.stat()
    const bytes = await desktopInvoke<ArrayBuffer>('fs_read', { root: this.root, relative: this.relative })
    return new File([bytes], info.name, { lastModified: info.modified })
  }
  async createWritable() {
    let data: Uint8Array<ArrayBuffer> | undefined
    let closed = false
    return {
      write: async (value: string | Blob | BufferSource) => {
        if (closed) throw new Error('文件写入已结束')
        if (typeof value === 'string') data = new TextEncoder().encode(value)
        else if (value instanceof Blob) data = new Uint8Array(await value.arrayBuffer())
        else if (ArrayBuffer.isView(value)) data = new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
        else data = new Uint8Array(value.slice(0))
      },
      close: async () => {
        if (closed) return
        if (data) await desktopInvoke('fs_write', { root: this.root, relative: this.relative, bytes: Array.from(data) })
        closed = true
      },
    }
  }
}
class NativeDirectory extends NativeHandle implements CourseDirectoryHandle {
  override readonly kind = 'directory' as const
  async *values(): AsyncIterableIterator<CourseDirectoryHandle | CourseFileHandle> {
    const entries = await desktopInvoke<NativeEntry[]>('fs_entries', { root: this.root, relative: this.relative })
    for (const e of entries) yield e.kind === 'directory' ? new NativeDirectory(this.root, e.relative, e.name, 'directory') : new NativeFile(this.root, e.relative, e.name, 'file')
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<CourseFileHandle> {
    const relative = this.childPath(name)
    try { await desktopInvoke('fs_child', { root: this.root, relative, directory: false, create: options?.create ?? false }) }
    catch (error) {
      if (/os error [23]\b/.test(String(error))) throw new DOMException('文件不存在', 'NotFoundError')
      throw error
    }
    return new NativeFile(this.root, relative, name, 'file')
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<CourseDirectoryHandle> {
    const relative = this.childPath(name)
    await desktopInvoke('fs_child', { root: this.root, relative, directory: true, create: options?.create ?? false })
    return new NativeDirectory(this.root, relative, name, 'directory')
  }
}
export function desktopDirectory(path: string): CourseDirectoryHandle {
  return new NativeDirectory(path, '', path.split(/[/\\]/).filter(Boolean).at(-1) ?? path, 'directory')
}
export function desktopRoot(handle: CourseDirectoryHandle): string {
  if (!(handle instanceof NativeDirectory) || handle.relative) throw new Error('无效的课程目录')
  return handle.root
}
export async function chooseCourseFolder(): Promise<CourseDirectoryHandle | null> {
  const entry = await desktopInvoke<NativeEntry | null>('choose_course_folder')
  return entry ? desktopDirectory(entry.path) : null
}
export async function fileMetadata(handle: CourseFileHandle): Promise<{ size: number; lastModified: number }> {
  if (!(handle instanceof NativeFile)) throw new Error('无效的本地文件')
  const entry = await handle.stat()
  return { size: entry.size, lastModified: entry.modified }
}
export async function mediaSource(handle: CourseFileHandle): Promise<{ url: string; release: () => void }> {
  if (!(handle instanceof NativeFile)) throw new Error('无效的本地视频')
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  const entry = await handle.stat()
  return { url: convertFileSrc(entry.path), release: () => {} }
}

export function nativeFileLocation(handle: CourseFileHandle): { root: string; relative: string } {
  if (!(handle instanceof NativeFile)) throw new Error('无效的本地视频')
  return { root: handle.root, relative: handle.relative }
}

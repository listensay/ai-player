/** 课程、字幕与笔记使用的本地文件接口，由 Tauri 原生命令实现。 */
export interface CourseHandle {
  readonly kind: 'directory' | 'file'
  readonly name: string
  isSameEntry(other: CourseHandle): Promise<boolean>
  /** 路径仍存在且位于已授权的课程目录内。 */
  isAvailable(): Promise<boolean>
}
export interface CourseFileHandle extends CourseHandle {
  readonly kind: 'file'
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: string | Blob | BufferSource): Promise<void>; close(): Promise<void> }>
}
export interface CourseDirectoryHandle extends CourseHandle {
  readonly kind: 'directory'
  values(): AsyncIterableIterator<CourseDirectoryHandle | CourseFileHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<CourseFileHandle>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<CourseDirectoryHandle>
}

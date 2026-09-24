import { desktopDirectory, desktopRoot } from './desktopFiles'
import { desktopInvoke } from './platform'
import type { CourseDirectoryHandle } from '~/types/storage'

/** 课程目录位置保存在 SQLite 数据库中。 */
export async function readCourseHandles(): Promise<Map<string, CourseDirectoryHandle>> {
  const saved = await desktopInvoke<Record<string, string>>('course_locations')
  return new Map(Object.entries(saved).map(([id, path]) => [id, desktopDirectory(path)]))
}

export async function saveCourseHandle(id: string, handle: CourseDirectoryHandle | null) {
  await desktopInvoke('save_course_location', { id, root: handle ? desktopRoot(handle) : null })
}

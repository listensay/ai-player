import type { RecentCourse, VideoProgress } from '~/types/course'
import type { StudyDay } from '~/types/checkIn'
import type { GuideSettings, LearningPlan, LearningQuestion, LessonMetadata, LessonPracticeRecord, TodayPlan } from '~/types/guide'

export async function dbFetchRecentCourses(): Promise<RecentCourse[]> {
  try {
    const data = await $fetch<RecentCourse[]>('/api/db/recent-courses')
    return data ?? []
  } catch (err) {
    console.warn('读取 SQLite 最近课程失败', err)
    return []
  }
}

export async function dbSaveRecentCourse(course: {
  id: string
  name: string
  videoCount: number
  lastOpenedAt: number
  lastVideoPath?: string
}): Promise<boolean> {
  try {
    await $fetch('/api/db/recent-courses', {
      method: 'POST',
      body: course,
    })
    return true
  } catch (err) {
    console.warn('保存 SQLite 最近课程失败', err)
    return false
  }
}

export async function dbDeleteRecentCourse(id: string): Promise<boolean> {
  try {
    await $fetch(`/api/db/recent-courses?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return true
  } catch (err) {
    console.warn('删除 SQLite 最近课程失败', err)
    return false
  }
}

export async function dbFetchAllProgress(): Promise<Record<string, Record<string, VideoProgress>>> {
  try {
    const data = await $fetch<Record<string, Record<string, VideoProgress>>>('/api/db/progress')
    return data ?? {}
  } catch (err) {
    console.warn('读取 SQLite 进度失败', err)
    return {}
  }
}

export async function dbSaveProgress(item: {
  courseId: string
  path: string
  time: number
  duration: number
  ratio: number
  done: boolean
}): Promise<boolean> {
  try {
    await $fetch('/api/db/progress', {
      method: 'POST',
      body: item,
    })
    return true
  } catch (err) {
    console.warn('保存 SQLite 进度失败', err)
    return false
  }
}

export async function dbFetchCheckIns(courseId: string): Promise<Record<string, StudyDay>> {
  try {
    const data = await $fetch<Record<string, StudyDay>>(`/api/db/check-in?courseId=${encodeURIComponent(courseId)}`)
    return data ?? {}
  } catch (err) {
    console.warn('读取 SQLite 打卡记录失败', err)
    return {}
  }
}

export async function dbSaveCheckIns(courseId: string, days: StudyDay[]): Promise<boolean> {
  try {
    await $fetch('/api/db/check-in', {
      method: 'POST',
      body: { courseId, days },
    })
    return true
  } catch (err) {
    console.warn('保存 SQLite 打卡记录失败', err)
    return false
  }
}

export async function dbFetchNote(courseId: string, videoPath: string): Promise<{ content: string; updatedAt: number | null }> {
  try {
    const data = await $fetch<{ content: string; updatedAt: number | null }>(
      `/api/db/notes?courseId=${encodeURIComponent(courseId)}&videoPath=${encodeURIComponent(videoPath)}`,
    )
    return data ?? { content: '', updatedAt: null }
  } catch (err) {
    console.warn('读取 SQLite 笔记失败', err)
    return { content: '', updatedAt: null }
  }
}

export async function dbSaveNote(courseId: string, videoPath: string, content: string): Promise<{ success: boolean; updatedAt?: number }> {
  try {
    const res = await $fetch<{ success: boolean; updatedAt: number }>('/api/db/notes', {
      method: 'POST',
      body: { courseId, videoPath, content },
    })
    return res
  } catch (err) {
    console.warn('保存 SQLite 笔记失败', err)
    return { success: false }
  }
}

export async function dbSaveNoteImage(image: {
  id?: string
  courseId: string
  videoPath: string
  name: string
  dataBase64: string
}): Promise<{ success: boolean; id?: string; dataBase64?: string }> {
  try {
    const res = await $fetch<{ success: boolean; id: string; dataBase64: string }>('/api/db/note-images', {
      method: 'POST',
      body: image,
    })
    return res
  } catch (err) {
    console.warn('保存 SQLite 笔记图片失败', err)
    return { success: false }
  }
}

export async function dbFetchNoteImages(courseId: string, videoPath: string): Promise<Array<{ id: string; name: string; data_base64: string }>> {
  try {
    const data = await $fetch<Array<{ id: string; name: string; data_base64: string }>>(
      `/api/db/note-images?courseId=${encodeURIComponent(courseId)}&videoPath=${encodeURIComponent(videoPath)}`,
    )
    return data ?? []
  } catch (err) {
    console.warn('读取 SQLite 笔记图片失败', err)
    return []
  }
}

export async function dbFetchGuide(courseId: string): Promise<{
  plan: LearningPlan | null
  metadata: Record<string, LessonMetadata>
  view: 'all' | 'route'
  includeOptional: boolean
  mastery: Record<string, any>
  questions: LearningQuestion[]
  today: TodayPlan | null
  updatedAt: number
} | null> {
  try {
    const data = await $fetch<any>(`/api/db/guide?courseId=${encodeURIComponent(courseId)}`)
    return data
  } catch (err) {
    console.warn('读取 SQLite 导学数据失败', err)
    return null
  }
}

export async function dbSaveGuide(data: {
  courseId: string
  plan: LearningPlan | null
  metadata: Record<string, LessonMetadata>
  view: string
  includeOptional: boolean
  mastery: Record<string, any>
  questions: LearningQuestion[]
  today: TodayPlan | null
}): Promise<boolean> {
  try {
    await $fetch('/api/db/guide', {
      method: 'POST',
      body: data,
    })
    return true
  } catch (err) {
    console.warn('保存 SQLite 导学数据失败', err)
    return false
  }
}

export async function dbFetchPractice(courseId: string): Promise<Record<string, LessonPracticeRecord[]>> {
  try {
    const data = await $fetch<Record<string, LessonPracticeRecord[]>>(`/api/db/practice?courseId=${encodeURIComponent(courseId)}`)
    return data ?? {}
  } catch (err) {
    console.warn('读取 SQLite 练习记录失败', err)
    return {}
  }
}

export async function dbSavePractice(courseId: string, videoPath: string, records: LessonPracticeRecord[]): Promise<boolean> {
  try {
    await $fetch('/api/db/practice', {
      method: 'POST',
      body: { courseId, videoPath, records },
    })
    return true
  } catch (err) {
    console.warn('保存 SQLite 练习记录失败', err)
    return false
  }
}

export async function dbFetchSetting<T>(key: string): Promise<T | null> {
  try {
    const data = await $fetch<T>(`/api/db/settings?key=${encodeURIComponent(key)}`)
    return data
  } catch (err) {
    console.warn(`读取 SQLite 设置 [${key}] 失败`, err)
    return null
  }
}

export async function dbSaveSetting<T>(key: string, value: T): Promise<boolean> {
  try {
    await $fetch('/api/db/settings', {
      method: 'POST',
      body: { key, value },
    })
    return true
  } catch (err) {
    console.warn(`保存 SQLite 设置 [${key}] 失败`, err)
    return false
  }
}

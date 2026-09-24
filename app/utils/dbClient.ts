import { databaseRequest } from '~/utils/database'
import type { RecentCourse, VideoProgress } from '~/types/course'
import type { PracticeRecord } from '~/types/practice'
import type { StudyDay } from '~/types/checkIn'
import type { LearningPlan, LearningQuestion, LessonMetadata, TodayPlan } from '~/types/guide'

export async function dbFetchRecentCourses(): Promise<RecentCourse[]> {
  try {
    const data = await databaseRequest<RecentCourse[]>('recent-courses')
    return data ?? []
  } catch (err) {
    console.warn('读取本地最近课程失败', err)
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
    await databaseRequest('recent-courses', {
      method: 'POST',
      body: course,
    })
    return true
  } catch (err) {
    console.warn('保存本地最近课程失败', err)
    return false
  }
}

export async function dbDeleteRecentCourse(id: string): Promise<boolean> {
  try {
    await databaseRequest('recent-courses', { query: { id },
      method: 'DELETE',
    })
    return true
  } catch (err) {
    console.warn('删除本地最近课程失败', err)
    return false
  }
}

export async function dbFetchAllProgress(): Promise<Record<string, Record<string, VideoProgress>>> {
  try {
    const data = await databaseRequest<Record<string, Record<string, VideoProgress>>>('progress')
    return data ?? {}
  } catch (err) {
    console.warn('读取本地进度失败', err)
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
    await databaseRequest('progress', {
      method: 'POST',
      body: item,
    })
    return true
  } catch (err) {
    console.warn('保存本地进度失败', err)
    return false
  }
}

export async function dbFetchCheckIns(courseId: string): Promise<Record<string, StudyDay>> {
  try {
    const data = await databaseRequest<Record<string, StudyDay>>('check-in', { query: { courseId } })
    return data ?? {}
  } catch (err) {
    console.warn('读取本地打卡记录失败', err)
    return {}
  }
}

export async function dbSaveCheckIns(courseId: string, days: StudyDay[]): Promise<boolean> {
  try {
    await databaseRequest('check-in', {
      method: 'POST',
      body: { courseId, days },
    })
    return true
  } catch (err) {
    console.warn('保存本地打卡记录失败', err)
    return false
  }
}

export async function dbFetchNote(courseId: string, videoPath: string): Promise<{ content: string; updatedAt: number | null }> {
  try {
    const data = await databaseRequest<{ content: string; updatedAt: number | null }>(
      'notes', { query: { courseId, videoPath } },
    )
    return data ?? { content: '', updatedAt: null }
  } catch (err) {
    console.warn('读取本地笔记失败', err)
    return { content: '', updatedAt: null }
  }
}

export async function dbSaveNote(courseId: string, videoPath: string, content: string): Promise<{ success: boolean; updatedAt?: number }> {
  try {
    const res = await databaseRequest<{ success: boolean; updatedAt: number }>('notes', {
      method: 'POST',
      body: { courseId, videoPath, content },
    })
    return res
  } catch (err) {
    console.warn('保存本地笔记失败', err)
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
    const res = await databaseRequest<{ success: boolean; id: string; dataBase64: string }>('note-images', {
      method: 'POST',
      body: image,
    })
    return res
  } catch (err) {
    console.warn('保存本地笔记图片失败', err)
    return { success: false }
  }
}

export async function dbFetchNoteImages(courseId: string, videoPath: string): Promise<Array<{ id: string; name: string; data_base64: string }>> {
  try {
    const data = await databaseRequest<Array<{ id: string; name: string; data_base64: string }>>(
      'note-images', { query: { courseId, videoPath } },
    )
    return data ?? []
  } catch (err) {
    console.warn('读取本地笔记图片失败', err)
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
    const data = await databaseRequest<any>('guide', { query: { courseId } })
    return data
  } catch (err) {
    console.warn('读取本地导学数据失败', err)
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
    await databaseRequest('guide', {
      method: 'POST',
      body: data,
    })
    return true
  } catch (err) {
    console.warn('保存本地导学数据失败', err)
    return false
  }
}

export async function dbFetchPractice(courseId: string): Promise<Record<string, PracticeRecord[]>> {
  try {
    const data = await databaseRequest<Record<string, PracticeRecord[]>>('practice', { query: { courseId } })
    return data ?? {}
  } catch (err) {
    console.warn('读取本地练习记录失败', err)
    return {}
  }
}

export async function dbSavePractice(courseId: string, videoPath: string, records: PracticeRecord[]): Promise<boolean> {
  try {
    await databaseRequest('practice', {
      method: 'POST',
      body: { courseId, videoPath, records },
    })
    return true
  } catch (err) {
    console.warn('保存本地练习记录失败', err)
    return false
  }
}

export async function dbFetchSetting<T>(key: string): Promise<T | null> {
  try {
    const data = await databaseRequest<T>('settings', { query: { key } })
    return data
  } catch (err) {
    console.warn(`读取本地设置 [${key}] 失败`, err)
    return null
  }
}

export async function dbSaveSetting<T>(key: string, value: T): Promise<boolean> {
  try {
    await databaseRequest('settings', {
      method: 'POST',
      body: { key, value },
    })
    return true
  } catch (err) {
    console.warn(`保存本地设置 [${key}] 失败`, err)
    return false
  }
}

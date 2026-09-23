import { getDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)
    const courseId = query.courseId as string
    if (!courseId) {
      // 获取全部课程的进度数据集合: { [courseId]: { [videoPath]: VideoProgress } }
      const stmt = db.prepare('SELECT course_id, video_path, time, duration, ratio, done, updated_at FROM video_progress')
      const rows = stmt.all() as Array<{
        course_id: string
        video_path: string
        time: number
        duration: number
        ratio: number
        done: number
        updated_at: number
      }>
      const result: Record<string, Record<string, any>> = {}
      for (const r of rows) {
        if (!result[r.course_id]) result[r.course_id] = {}
        result[r.course_id]![r.video_path] = {
          time: r.time,
          duration: r.duration,
          ratio: r.ratio,
          done: r.done === 1,
          updatedAt: r.updated_at,
        }
      }
      return result
    }

    // 获取特定课程的进度
    const stmt = db.prepare('SELECT video_path, time, duration, ratio, done, updated_at FROM video_progress WHERE course_id = ?')
    const rows = stmt.all(courseId) as Array<{
      video_path: string
      time: number
      duration: number
      ratio: number
      done: number
      updated_at: number
    }>
    const map: Record<string, any> = {}
    for (const r of rows) {
      map[r.video_path] = {
        time: r.time,
        duration: r.duration,
        ratio: r.ratio,
        done: r.done === 1,
        updatedAt: r.updated_at,
      }
    }
    return map
  }

  if (method === 'POST') {
    const body = await readBody(event)
    const { courseId, path, time, duration, ratio, done } = body
    if (!courseId || !path) {
      throw createError({ statusCode: 400, message: 'Missing courseId or path' })
    }
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO video_progress (course_id, video_path, time, duration, ratio, done, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(course_id, video_path) DO UPDATE SET
        time = excluded.time,
        duration = excluded.duration,
        ratio = excluded.ratio,
        done = excluded.done,
        updated_at = excluded.updated_at
    `)
    stmt.run(courseId, path, time ?? 0, duration ?? 0, ratio ?? 0, done ? 1 : 0, now)
    return { success: true }
  }
})

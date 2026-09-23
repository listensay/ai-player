import { getDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)
    const courseId = query.courseId as string
    const videoPath = query.videoPath as string
    if (!courseId || !videoPath) {
      throw createError({ statusCode: 400, message: 'Missing courseId or videoPath' })
    }
    const stmt = db.prepare('SELECT content, updated_at FROM notes WHERE course_id = ? AND video_path = ?')
    const row = stmt.get(courseId, videoPath) as { content: string; updated_at: number } | undefined
    if (!row) {
      return { content: '', updatedAt: null }
    }
    return {
      content: row.content,
      updatedAt: row.updated_at,
    }
  }

  if (method === 'POST') {
    const body = await readBody(event)
    const { courseId, videoPath, content } = body
    if (!courseId || !videoPath || typeof content !== 'string') {
      throw createError({ statusCode: 400, message: 'Missing courseId, videoPath or content' })
    }
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO notes (course_id, video_path, content, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(course_id, video_path) DO UPDATE SET
        content = excluded.content,
        updated_at = excluded.updated_at
    `)
    stmt.run(courseId, videoPath, content, now)
    return { success: true, updatedAt: now }
  }
})

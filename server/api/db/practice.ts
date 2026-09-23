import { getDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)
    const courseId = query.courseId as string
    if (!courseId) {
      throw createError({ statusCode: 400, message: 'Missing courseId' })
    }
    const stmt = db.prepare('SELECT video_path, records_json, updated_at FROM lesson_practices WHERE course_id = ?')
    const rows = stmt.all(courseId) as Array<{
      video_path: string
      records_json: string
      updated_at: number
    }>
    const map: Record<string, any> = {}
    for (const r of rows) {
      try {
        map[r.video_path] = JSON.parse(r.records_json)
      } catch {
        map[r.video_path] = []
      }
    }
    return map
  }

  if (method === 'POST') {
    const body = await readBody(event)
    const { courseId, videoPath, records } = body
    if (!courseId || !videoPath || !Array.isArray(records)) {
      throw createError({ statusCode: 400, message: 'Missing courseId, videoPath or records array' })
    }
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO lesson_practices (course_id, video_path, records_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(course_id, video_path) DO UPDATE SET
        records_json = excluded.records_json,
        updated_at = excluded.updated_at
    `)
    stmt.run(courseId, videoPath, JSON.stringify(records), now)
    return { success: true }
  }
})

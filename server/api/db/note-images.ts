import { getDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)
    const { id, courseId, videoPath } = query as { id?: string; courseId?: string; videoPath?: string }

    if (id) {
      const stmt = db.prepare('SELECT id, name, data_base64 FROM note_images WHERE id = ?')
      const row = stmt.get(id) as { id: string; name: string; data_base64: string } | undefined
      if (!row) {
        throw createError({ statusCode: 404, message: 'Image not found' })
      }
      return row
    }

    if (courseId && videoPath) {
      const stmt = db.prepare('SELECT id, name, data_base64, created_at FROM note_images WHERE course_id = ? AND video_path = ? ORDER BY created_at ASC')
      const rows = stmt.all(courseId, videoPath) as Array<{
        id: string
        name: string
        data_base64: string
        created_at: number
      }>
      return rows
    }

    throw createError({ statusCode: 400, message: 'Missing parameters' })
  }

  if (method === 'POST') {
    const body = await readBody(event)
    const { id, courseId, videoPath, name, dataBase64 } = body
    if (!courseId || !videoPath || !name || !dataBase64) {
      throw createError({ statusCode: 400, message: 'Missing required image fields' })
    }
    const imageId = id || crypto.randomUUID()
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO note_images (id, course_id, video_path, name, data_base64, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    stmt.run(imageId, courseId, videoPath, name, dataBase64, now)
    return { success: true, id: imageId, name, dataBase64 }
  }
})

import { getDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const method = getMethod(event)

  if (method === 'GET') {
    const stmt = db.prepare('SELECT id, name, video_count, last_opened_at, last_video_path FROM recent_courses ORDER BY last_opened_at DESC LIMIT 20')
    const rows = stmt.all() as Array<{
      id: string
      name: string
      video_count: number
      last_opened_at: number
      last_video_path: string | null
    }>
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      videoCount: r.video_count,
      lastOpenedAt: r.last_opened_at,
      lastVideoPath: r.last_video_path ?? undefined,
    }))
  }

  if (method === 'POST') {
    const body = await readBody(event)
    const { id, name, videoCount, lastOpenedAt, lastVideoPath } = body
    if (!id || !name) {
      throw createError({ statusCode: 400, message: 'Missing id or name' })
    }
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO recent_courses (id, name, video_count, last_opened_at, last_video_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        video_count = excluded.video_count,
        last_opened_at = excluded.last_opened_at,
        last_video_path = excluded.last_video_path,
        updated_at = excluded.updated_at
    `)
    stmt.run(id, name, videoCount ?? 0, lastOpenedAt ?? now, lastVideoPath ?? null, now, now)
    return { success: true }
  }

  if (method === 'DELETE') {
    const query = getQuery(event)
    const id = (query.id as string) || (await readBody(event).catch(() => ({})))?.id
    if (!id) {
      throw createError({ statusCode: 400, message: 'Missing id' })
    }
    const stmt = db.prepare('DELETE FROM recent_courses WHERE id = ?')
    stmt.run(id)
    return { success: true }
  }
})

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
    const stmt = db.prepare('SELECT date, seconds, target_seconds, checked_at FROM check_ins WHERE course_id = ?')
    const rows = stmt.all(courseId) as Array<{
      date: string
      seconds: number
      target_seconds: number
      checked_at: number | null
    }>
    const map: Record<string, any> = {}
    for (const r of rows) {
      map[r.date] = {
        date: r.date,
        seconds: r.seconds,
        targetSeconds: r.target_seconds,
        checkedAt: r.checked_at,
      }
    }
    return map
  }

  if (method === 'POST') {
    const body = await readBody(event)
    const { courseId, days } = body
    if (!courseId || !Array.isArray(days)) {
      throw createError({ statusCode: 400, message: 'Missing courseId or days array' })
    }
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO check_ins (course_id, date, seconds, target_seconds, checked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(course_id, date) DO UPDATE SET
        seconds = excluded.seconds,
        target_seconds = excluded.target_seconds,
        checked_at = excluded.checked_at,
        updated_at = excluded.updated_at
    `)
    for (const d of days) {
      if (!d.date) continue
      stmt.run(
        courseId,
        d.date,
        d.seconds ?? 0,
        d.targetSeconds ?? 0,
        d.checkedAt ?? null,
        now,
        now,
      )
    }
    return { success: true }
  }
})

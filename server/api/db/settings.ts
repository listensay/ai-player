import { getDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const method = getMethod(event)

  if (method === 'GET') {
    const query = getQuery(event)
    const key = query.key as string
    if (key) {
      const stmt = db.prepare('SELECT value_json, updated_at FROM app_settings WHERE key = ?')
      const row = stmt.get(key) as { value_json: string; updated_at: number } | undefined
      if (!row) return null
      try {
        return JSON.parse(row.value_json)
      } catch {
        return null
      }
    }

    const stmt = db.prepare('SELECT key, value_json FROM app_settings')
    const rows = stmt.all() as Array<{ key: string; value_json: string }>
    const result: Record<string, any> = {}
    for (const r of rows) {
      try {
        result[r.key] = JSON.parse(r.value_json)
      } catch {
        result[r.key] = null
      }
    }
    return result
  }

  if (method === 'POST') {
    const body = await readBody(event)
    const { key, value } = body
    if (!key) {
      throw createError({ statusCode: 400, message: 'Missing key' })
    }
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `)
    stmt.run(key, JSON.stringify(value), now)
    return { success: true }
  }
})

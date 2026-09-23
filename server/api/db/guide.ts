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
    const stmt = db.prepare('SELECT plan_json, metadata_json, view, include_optional, mastery_json, questions_json, today_json, updated_at FROM learning_guides WHERE course_id = ?')
    const row = stmt.get(courseId) as {
      plan_json: string | null
      metadata_json: string | null
      view: string
      include_optional: number
      mastery_json: string | null
      questions_json: string | null
      today_json: string | null
      updated_at: number
    } | undefined

    if (!row) return null

    return {
      plan: row.plan_json ? JSON.parse(row.plan_json) : null,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      view: row.view || 'all',
      includeOptional: row.include_optional === 1,
      mastery: row.mastery_json ? JSON.parse(row.mastery_json) : {},
      questions: row.questions_json ? JSON.parse(row.questions_json) : [],
      today: row.today_json ? JSON.parse(row.today_json) : null,
      updatedAt: row.updated_at,
    }
  }

  if (method === 'POST') {
    const body = await readBody(event)
    const { courseId, plan, metadata, view, includeOptional, mastery, questions, today } = body
    if (!courseId) {
      throw createError({ statusCode: 400, message: 'Missing courseId' })
    }
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO learning_guides (course_id, plan_json, metadata_json, view, include_optional, mastery_json, questions_json, today_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(course_id) DO UPDATE SET
        plan_json = excluded.plan_json,
        metadata_json = excluded.metadata_json,
        view = excluded.view,
        include_optional = excluded.include_optional,
        mastery_json = excluded.mastery_json,
        questions_json = excluded.questions_json,
        today_json = excluded.today_json,
        updated_at = excluded.updated_at
    `)
    stmt.run(
      courseId,
      plan ? JSON.stringify(plan) : null,
      metadata ? JSON.stringify(metadata) : null,
      view ?? 'all',
      includeOptional ? 1 : 0,
      mastery ? JSON.stringify(mastery) : null,
      questions ? JSON.stringify(questions) : null,
      today ? JSON.stringify(today) : null,
      now,
    )
    return { success: true }
  }
})

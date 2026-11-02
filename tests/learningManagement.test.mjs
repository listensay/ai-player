import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/database')
      return {
        url: 'data:text/javascript,export const databaseRequest=async()=>null;export const flushDatabaseWrites=async()=>{}',
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { emptyLearningManagement, parseLearningManagement } = await import('../app/utils/learningManagement.ts')
const { learningCalendar, foldCalendarLine } = await import('../app/utils/learningOutcomes.ts')
const { createLearningManagement } = await import('../app/composables/useLearningManagement.ts')
const { emptyStudyRecords } = await import('../app/utils/studyProgram.ts')
const today = '2026-10-05'
const now = new Date(`${today}T12:00:00`).getTime()
function course() {
  return {
    course: { id: 'course', name: '前端学习', status: 'active' },
    days: {},
    snapshots: {},
    error: '',
    context: {
      plan: {
        version: 1,
        createdAt: now,
        summary: '搭建页面',
        profile: '学习基础',
        messages: [],
        dailyMinutes: 60,
        program: {
          days: 14,
          startDate: '2026-09-28',
          budget: { video: 60, code: 0, project: 0, recap: 0 },
          lightEvery: 0,
          lightMinutes: 15,
          calendar: { weekdays: [1, 2, 3, 4, 5], overrides: {} },
        },
        modules: [
          {
            id: 'stage',
            title: '阶段一',
            description: '基础',
            practice: {
              startDay: 1,
              endDay: 14,
              goal: '作品',
              project: 'Todo',
              skipWhen: '完成',
              tasks: [],
              checks: [{ id: 'check', kind: 'project', text: '完成作品' }],
            },
          },
        ],
        lessons: [1, 2, 3].map((i) => ({
          path: `${i}.mp4`,
          moduleId: 'stage',
          concepts: ['概念'],
          prerequisites: [],
          status: 'required',
          reason: '必修基础',
        })),
      },
      metadata: Object.fromEntries([1, 2, 3].map((i) => [`${i}.mp4`, { duration: 3600, size: 0, modified: 0 }])),
      progress: {},
      mastery: {},
      questions: [],
      records: emptyStudyRecords(),
      today: null,
      enabled: true,
    },
  }
}

test('学习管理只恢复日历设置，移除复习、心流、保护和退役偏好', () => {
  const saved = { version: 1, preferences: { calendarTime: '08:30', calendarDays: 14, calendarEnabled: true } }
  const legacy = {
    ...saved,
    cards: [{}],
    flows: [{}],
    protections: [{}],
    contracts: [{}],
    works: [{}],
    rewardDays: [],
    preferences: { ...saved.preferences, flowPrompt: true, shortcut: 'Study', quietFocus: true },
  }
  assert.deepEqual(parseLearningManagement(legacy), saved)
  assert.deepEqual(parseLearningManagement({ ...legacy, cards: null, flows: 'invalid', protections: 42 }), saved)
  assert.deepEqual(parseLearningManagement(saved), saved)
  assert.deepEqual(parseLearningManagement(null), emptyLearningManagement())
  assert.equal(legacy.preferences.flowPrompt, true)
})
test('日历设置拒绝未知版本和非法输入，不覆盖已有数据', () => {
  const saved = emptyLearningManagement()
  assert.throws(() => parseLearningManagement({ ...saved, version: 2 }))
  for (const preferences of [
    null,
    { ...saved.preferences, calendarTime: '25:99' },
    { ...saved.preferences, calendarDays: 0 },
    { ...saved.preferences, calendarDays: 91 },
    { ...saved.preferences, calendarDays: NaN },
    { ...saved.preferences, calendarEnabled: 'true' },
  ])
    assert.throws(() => parseLearningManagement({ ...saved, preferences }))
})
test('日历逐日推进章节、课程不重叠，UID 稳定，中文折行按字节计算', () => {
  const c = course()
  c.context.plan.program.calendar.weekdays = [1, 2, 3, 4, 5, 6, 7]
  const calendar = learningCalendar([c], today, '20:00', 3, now)
  const unfolded = calendar.replace(/\r\n /g, '')
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) ?? []).length, 3)
  for (const path of ['1.mp4', '2.mp4', '3.mp4']) assert.ok(unfolded.includes(path))
  assert.ok(unfolded.includes('DTSTART:'))
  assert.ok(unfolded.includes('URL:aiplayer://lesson?'))
  assert.equal(calendar, learningCalendar([c], today, '20:00', 3, now))
  assert.ok(calendar.split('\r\n').every((line) => Buffer.byteLength(line) <= 75))
  assert.equal(foldCalendarLine('学'.repeat(100)).replace(/\r\n /g, ''), '学'.repeat(100))
  assert.throws(() => learningCalendar([c], today, '99:00', 30))
})

test('日历保存失败不提交状态，连续修改按成功保存的设置串行执行', async () => {
  let fail = true,
    persisted = null
  const store = createLearningManagement({
    read: async () => null,
    write: async (value) => {
      if (fail) throw Error('disk full')
      persisted = structuredClone(value)
    },
  })
  await store.load()
  assert.equal(
    await store.mutate((data) => {
      data.preferences.calendarTime = '08:30'
    }),
    false,
  )
  assert.equal(store.state.data.preferences.calendarTime, '20:00')
  fail = false
  await Promise.all([
    store.mutate((data) => {
      data.preferences.calendarTime = '08:30'
    }),
    store.mutate((data) => {
      data.preferences.calendarDays = 14
    }),
  ])
  assert.deepEqual(persisted.preferences, { calendarTime: '08:30', calendarDays: 14, calendarEnabled: false })
  assert.equal(store.state.saving, 0)
  const restored = createLearningManagement({ read: async () => persisted, write: async () => {} })
  await restored.load()
  assert.deepEqual(JSON.parse(JSON.stringify(restored.state.data)), persisted)
})

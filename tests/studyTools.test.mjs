import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deliverReminder, emptyStudyTools, parseStudyTools, reminderDue, updateReminder } from '../app/utils/studyTools.ts'

const reminder = (patch = {}) => ({ id: 'r', title: '复习课程', time: '20:00', weekdays: [1, 2, 3, 4, 5, 6, 7], courseId: '', enabled: true, pending: false, lastNotifiedDate: '', snoozedUntil: null, ...patch })

test('缺省数据可建立，损坏、未知版本和非法字段不能覆盖已有记录', () => {
  assert.deepEqual(parseStudyTools(null), emptyStudyTools())
  for (const raw of [undefined, {}, { ...emptyStudyTools(), version: 2 }, { ...emptyStudyTools(), reminders: [reminder({ time: '24:00' })] },
    { ...emptyStudyTools(), reminders: [reminder({ weekdays: [] })] }, { ...emptyStudyTools(), reminders: [reminder({ weekdays: [1, 1] })] },
    { ...emptyStudyTools(), reminders: [reminder({ lastNotifiedDate: '2026-02-30' })] },
    { ...emptyStudyTools(), reminders: [reminder({ snoozedUntil: NaN })] }]) assert.throws(() => parseStudyTools(raw))
})

test('仅有提醒的数据可保存，往返保留发送状态并隔离修改', () => {
  const raw = { ...emptyStudyTools(), reminders: [reminder({ lastNotifiedDate: '2026-09-26', snoozedUntil: 1790453400000 })] }
  const restored = parseStudyTools(JSON.parse(JSON.stringify(raw)))
  assert.deepEqual(restored, raw)
  restored.reminders[0].weekdays.pop()
  assert.equal(raw.reminders[0].weekdays.length, 7)
})

test('旧版目标与标签不会阻止提醒更新，保存时保留历史字段', () => {
  const raw = { ...emptyStudyTools(), reminders: [reminder()],
    goals: [{ id: 'g', kind: 'manual', current: 3 }], tags: [{ id: 't', name: '前端', courseIds: ['a', 'b'] }] }
  const restored = parseStudyTools(JSON.parse(JSON.stringify(raw)))
  updateReminder(restored, reminder({ title: '更新提醒', time: '21:00' }))
  const saved = parseStudyTools(JSON.parse(JSON.stringify(restored)))
  assert.equal(saved.reminders[0].title, '更新提醒')
  assert.equal(saved.reminders[0].time, '21:00')
  assert.deepEqual(saved.goals, raw.goals)
  assert.deepEqual(saved.tags, raw.tags)
  saved.tags[0].courseIds.pop()
  assert.equal(raw.tags[0].courseIds.length, 2)
  assert.doesNotThrow(() => parseStudyTools({ ...raw, goals: null, tags: 'legacy data' }))
})

test('按本地星期和时间触发，当天补发一次，重启后不重复', () => {
  const r = reminder({ weekdays: [6] })
  assert.equal(reminderDue(r, new Date(2026, 8, 26, 19, 59)), null)
  assert.equal(reminderDue(r, new Date(2026, 8, 26, 20, 0)), 'scheduled')
  assert.equal(reminderDue(r, new Date(2026, 8, 26, 23, 0)), 'scheduled')
  const restored = JSON.parse(JSON.stringify({ ...r, lastNotifiedDate: '2026-09-26' }))
  assert.equal(reminderDue(restored, new Date(2026, 8, 26, 23, 1)), null)
  assert.equal(reminderDue(restored, new Date(2026, 8, 27, 20, 0)), null)
  assert.equal(reminderDue(restored, new Date(2026, 9, 3, 20, 0)), 'scheduled')
  assert.equal(reminderDue({ ...r, enabled: false }, new Date(2026, 8, 26, 20, 0)), null)
})

test('稍后提醒跨午夜生效，等待期间不被当天定时提醒抢先触发', () => {
  const deadline = new Date(2026, 8, 27, 0, 5)
  const r = reminder({ weekdays: [6], snoozedUntil: deadline.getTime(), lastNotifiedDate: '2026-09-26' })
  assert.equal(reminderDue(r, new Date(2026, 8, 26, 23, 59)), null)
  assert.equal(reminderDue(r, deadline), 'snoozed')
  assert.equal(reminderDue({ ...r, snoozedUntil: null }, deadline), null)
})

test('编辑期间触发或延后的提醒不会被旧表单覆盖而重复发送', () => {
  const data = emptyStudyTools(), draft = reminder()
  data.reminders.push(reminder({ lastNotifiedDate: '2026-09-26', pending: true }))
  updateReminder(data, { ...draft, title: '更新内容' })
  assert.equal(data.reminders[0].lastNotifiedDate, '2026-09-26')
  assert.equal(data.reminders[0].pending, true)
  assert.equal(reminderDue(data.reminders[0], new Date(2026, 8, 26, 21)), null)
  data.reminders[0].snoozedUntil = 1790453400000
  updateReminder(data, draft)
  assert.equal(data.reminders[0].snoozedUntil, 1790453400000)
  updateReminder(data, { ...draft, enabled: false })
  assert.equal(data.reminders[0].pending, false)
  assert.equal(data.reminders[0].snoozedUntil, null)
})

test('延后至次日且超过当日提醒时间时合并发送，避免连续弹出两次', () => {
  const now = new Date(2026, 8, 27, 0, 5)
  const r = reminder({ time: '00:00', lastNotifiedDate: '2026-09-26', snoozedUntil: now.getTime() })
  assert.equal(deliverReminder(r, now), true)
  assert.equal(r.pending, true)
  assert.equal(r.snoozedUntil, null)
  assert.equal(r.lastNotifiedDate, '2026-09-27')
  assert.equal(deliverReminder(r, new Date(2026, 8, 27, 0, 6)), false)
})

const { macReminderSnapshot, macReminderStatus } = await import('../app/utils/studyTools.ts')
const macLink = (r) => ({ identifier: 'native-id', calendar: 'AI Player', exportedAt: 123, snapshot: macReminderSnapshot(r) })

test('同步快照识别标题、时间、重复日、关联课程修改；发送与延后不会误报待更新', () => {
  const r = reminder(), link = macLink(r)
  assert.equal(macReminderStatus(r, undefined).label, '未添加')
  assert.equal(macReminderStatus(r, link).label, '已添加')
  for (const patch of [{ title: '新标题' }, { time: '21:00' }, { weekdays: [1] }, { courseId: 'other' }]) {
    assert.equal(macReminderStatus({ ...r, ...patch }, link).label, '修改后待更新')
  }
  assert.equal(macReminderStatus({ ...r, pending: true, snoozedUntil: 1, lastNotifiedDate: '2026-09-26', weekdays: [...r.weekdays].reverse() }, link).pending, false)
  // Restart retains the last successfully exported values, not the current edited draft.
  assert.equal(macReminderStatus({ ...r, time: '21:00' }, JSON.parse(JSON.stringify(link))).pending, true)
  assert.equal(macReminderStatus(r, { ...link, snapshot: undefined }).label, '修改后待更新')
})

test('停用、课程暂停、重新启用与同步失败都保留明确的待处理状态', () => {
  const r = reminder(), link = macLink(r), disabled = { ...r, enabled: false }
  assert.equal(macReminderStatus(disabled, link).label, '停用待同步')
  assert.equal(macReminderStatus(r, link, false).label, '停用待同步')
  const pausedLink = { ...link, snapshot: macReminderSnapshot(r, false) }
  assert.equal(macReminderStatus(r, pausedLink, false).label, '已同步停用')
  assert.equal(macReminderStatus(r, pausedLink, true).label, '启用待同步')
  assert.equal(macReminderStatus(disabled, macLink(disabled)).pending, false)
  assert.equal(macReminderStatus({ ...r, title: '保存未同步' }, link).pending, true)
  assert.equal(link.snapshot.title, r.title)
})

const { hasStudyActivity, studiedForReminder, suppressStudiedReminder } = await import('../app/utils/studyTools.ts')
test('以当天实际观看或实践投入判断开始学习，浏览课程和历史进度不算', () => {
  const date = '2026-09-28'
  assert.equal(hasStudyActivity({ [date]: { seconds: 0 } }, null, date), false)
  assert.equal(hasStudyActivity({ '2026-09-27': { seconds: 100 } }, null, date), false)
  assert.equal(hasStudyActivity({ [date]: { seconds: 0.2 } }, null, date), true)
  assert.equal(hasStudyActivity({}, { entries: [{ date, minutes: 1 }] }, date), true)
  assert.equal(hasStudyActivity({}, { entries: [{ date, minutes: 0, done: true }] }, date), false)
  assert.equal(hasStudyActivity({}, { entries: [{ date: '2026-09-27', minutes: 10 }] }, date), false)
})
test('课程提醒只匹配关联课程，通用提醒匹配任何课程，次日恢复', () => {
  const studied = { a: '2026-09-28' }
  assert.equal(studiedForReminder(reminder({ courseId: 'a' }), studied, '2026-09-28'), true)
  assert.equal(studiedForReminder(reminder({ courseId: 'b' }), studied, '2026-09-28'), false)
  assert.equal(studiedForReminder(reminder(), studied, '2026-09-28'), true)
  assert.equal(studiedForReminder(reminder(), studied, '2026-09-29'), false)
})
test('开始学习消除已弹出和稍后提醒，保存重启不补发，次日正常提醒', () => {
  const now = new Date(2026, 8, 28, 19)
  const r = reminder({ pending: true, snoozedUntil: now.getTime() + 600000 })
  assert.equal(suppressStudiedReminder(r, now), true)
  assert.equal(r.pending, false)
  assert.equal(r.snoozedUntil, null)
  const restored = JSON.parse(JSON.stringify(r))
  assert.equal(deliverReminder(restored, new Date(2026, 8, 28, 21)), false)
  assert.equal(suppressStudiedReminder(restored, now), false)
  assert.equal(deliverReminder(restored, new Date(2026, 8, 29, 20)), true)
})

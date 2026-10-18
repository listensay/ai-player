import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAiChatHistory, parseAiChatHistory } from '../app/utils/aiChatHistory.ts'

const session = (id = 'one', markdown = '回答') => ({
  id,
  courseId: 'course',
  path: `${id}.mp4`,
  courseName: '课程',
  videoTitle: '第一课',
  title: '我的问题',
  createdAt: 1000,
  updatedAt: 2000,
  turns: [{ id: 'turn', question: '我的问题', markdown, seconds: 15, model: 'model', error: '', status: 'done' }],
})
const data = (...sessions) => ({ version: 1, sessions })

test('旧数据库无历史时初始化为空，持久化往返保留消息并恢复中断状态', () => {
  assert.deepEqual(parseAiChatHistory(null), data())
  const saved = data(session())
  assert.deepEqual(parseAiChatHistory(JSON.parse(JSON.stringify(saved))), saved)
  saved.sessions[0].turns[0].status = 'pending'
  assert.equal(parseAiChatHistory(saved, true).sessions[0].turns[0].status, 'stopped')
  assert.equal(saved.sessions[0].turns[0].status, 'pending')
  saved.sessions[0].apiKey = 'secret'
  saved.sessions[0].turns[0].settings = { apiKey: 'secret' }
  assert.ok(!JSON.stringify(parseAiChatHistory(saved)).includes('secret'))
})

test('未知版本与无效历史不覆盖磁盘记录，读取恢复后合并未保存会话', async () => {
  for (const invalid of [
    { version: 2, sessions: [] },
    data(session(), session()),
    data({ ...session(), path: '' }),
    data({ ...session(), turns: [{ ...session().turns[0], seconds: NaN }] }),
  ]) {
    let stored = invalid
    const writes = []
    const history = createAiChatHistory({
      read: async () => stored,
      write: async (value) => writes.push(value),
    })
    assert.equal(await history.save(session('new')), false)
    assert.equal(writes.length, 0)
    assert.equal(history.state.sessions[0].id, 'new')
    assert.match(history.state.error, /读取失败/)
    await assert.rejects(history.flush(), /读取失败/)
    stored = data(session('old'))
    assert.equal(await history.retry(), true)
    assert.deepEqual(
      writes[0].sessions.map((item) => item.id),
      ['old', 'new'],
    )
  }
})

test('读取未完成时发送消息，合并已有历史且保留最新快照', async () => {
  let release
  const writes = []
  const history = createAiChatHistory({
    read: () => new Promise((resolve) => (release = resolve)),
    write: async (value) => writes.push(value),
  })
  const loading = history.load()
  const first = history.save(session('new', '旧回答'))
  const latest = session('new', '新回答')
  const second = history.save(latest)
  latest.turns[0].markdown = '写入后外部修改'
  release(data(session('existing')))
  await Promise.all([loading, first, second])
  assert.deepEqual(
    writes.at(-1).sessions.map((item) => item.id),
    ['existing', 'new'],
  )
  assert.equal(writes.at(-1).sessions[1].turns[0].markdown, '新回答')
})

test('串行写入不丢失写入期间新增的消息，失败可重试', async () => {
  let release
  let fail = false
  const writes = []
  const history = createAiChatHistory({
    read: async () => null,
    write: async (value) => {
      if (fail) throw Error('disk full')
      writes.push(value)
      if (writes.length === 1) await new Promise((resolve) => (release = resolve))
    },
  })
  await history.load()
  const first = history.save(session('one', '回答一'))
  // The first write has started and holds its own snapshot.
  await new Promise((resolve) => setImmediate(resolve))
  const second = history.save(session('one', '回答二'))
  release()
  await Promise.all([first, second])
  assert.equal(writes[0].sessions[0].turns[0].markdown, '回答一')
  assert.equal(writes[1].sessions[0].turns[0].markdown, '回答二')
  fail = true
  assert.equal(await history.save(session('two')), false)
  assert.equal(history.state.sessions.length, 2)
  await assert.rejects(history.flush(), /保存失败/)
  fail = false
  await history.flush()
  assert.equal(writes.at(-1).sessions.length, 2)
  assert.equal(history.state.error, '')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createReminderLinkConsumer } from '../app/utils/reminderLinks.ts'

const fixture = () => {
  const state = { pending: { token: 'one', reminderId: 'reminder' }, opened: [], errors: [], fail: false, ackFail: false }
  const consumer = createReminderLinkConsumer({
    pending: async () => state.pending,
    open: async request => { if (state.fail) throw new Error('笔记未保存'); state.opened.push(request.token) },
    acknowledge: async token => { if (state.ackFail) throw new Error('暂时无法确认'); if (state.pending?.token === token) state.pending = null },
    error: message => state.errors.push(message),
  })
  return { state, consumer }
}

test('启动读取与实时事件同时发生时只打开一次，确认后不再重放', async () => {
  const { state, consumer } = fixture()
  await Promise.all([consumer.wake(), consumer.wake(), consumer.wake()])
  assert.deepEqual(state.opened, ['one']); assert.equal(state.pending, null)
})

test('保存失败保留待打开请求，重试成功后再确认', async () => {
  const { state, consumer } = fixture()
  state.fail = true
  await consumer.wake()
  assert.deepEqual(state.opened, []); assert.equal(state.pending.token, 'one')
  assert.match(state.errors.at(-1), /笔记未保存/)
  state.fail = false
  await consumer.wake()
  assert.deepEqual(state.opened, ['one']); assert.equal(state.pending, null); assert.equal(state.errors.at(-1), '')
})

test('页面已打开但确认失败时，重试不会重新打开或回退播放位置', async () => {
  const { state, consumer } = fixture()
  state.ackFail = true
  await consumer.wake()
  state.ackFail = false
  await consumer.wake()
  assert.deepEqual(state.opened, ['one']); assert.equal(state.pending, null)
})

test('打开期间收到新提醒，旧请求确认不会吞掉新目标', async () => {
  let pending = { token: 'one', reminderId: 'a' }, release
  const opened = []
  const gate = new Promise(resolve => { release = resolve })
  const consumer = createReminderLinkConsumer({
    pending: async () => pending,
    open: async request => { opened.push(request.reminderId); if (request.token === 'one') await gate },
    acknowledge: async token => { if (pending?.token === token) pending = null }, error: () => {},
  })
  const first = consumer.wake()
  await new Promise(resolve => setImmediate(resolve))
  pending = { token: 'two', reminderId: 'b' }
  const second = consumer.wake(); release()
  await Promise.all([first, second])
  assert.deepEqual(opened, ['a', 'b']); assert.equal(pending, null)
})

test('卸载后不执行仍排队的提醒跳转', async () => {
  const { state, consumer } = fixture()
  const pending = consumer.wake(); consumer.stop(); await pending
  assert.deepEqual(state.opened, [])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { useNoteSession } from '../app/composables/useNoteSession.ts'
const tick = () => new Promise((resolve) => setImmediate(resolve))
function session(write = async () => ({ success: true })) {
  return useNoteSession({
    read: async () => ({ content: 'saved', updatedAt: 1 }),
    readCopy: async () => null,
    write,
    writeCopy: async () => {},
  })
}
test('连续输入立即标脏，仅在保存时转换一次最新文档', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const saved = [],
    note = session(async (content) => {
      saved.push(content)
      return { success: true }
    })
  await note.load()
  let conversions = 0
  for (let i = 0; i < 100; i++)
    note.editFrom(() => {
      conversions++
      return `edit ${i}`
    })
  assert.equal(note.state.dirty, true)
  assert.equal(conversions, 0)
  t.mock.timers.tick(800)
  await tick()
  assert.equal(conversions, 1)
  assert.deepEqual(saved, ['edit 99'])
  assert.equal(note.state.dirty, false)
})
test('即时读取、切课保存和销毁会先取到最新文档，撤销到原文不写入', async (t) => {
  const saved = [],
    note = session(async (content) => {
      saved.push(content)
      return { success: true }
    })
  t.after(() => note.dispose())
  await note.load()
  note.editFrom(() => 'latest')
  assert.equal(note.readContent(), 'latest')
  await note.save()
  note.editFrom(() => 'latest')
  await note.save()
  assert.deepEqual(saved, ['latest'])
  let alive = true
  note.editFrom(() => {
    assert.equal(alive, true)
    return 'before destroy'
  })
  note.dispose()
  alive = false
  await tick()
  assert.deepEqual(saved, ['latest', 'before destroy'])
})
test('写入过程中继续输入仍会保存最新文档，失败可重试', async () => {
  let release
  const saved = [],
    note = session((content) => {
      saved.push(content)
      return saved.length === 1
        ? new Promise((resolve) => {
            release = resolve
          })
        : Promise.resolve({ success: true })
    })
  await note.load()
  note.editFrom(() => 'first')
  const writing = note.save()
  note.editFrom(() => 'second')
  release({ success: true })
  await writing
  assert.deepEqual(saved, ['first', 'second'])
  const retry = session(async () => {
    throw Error('disk')
  })
  await retry.load()
  retry.editFrom(() => 'unsaved')
  await assert.rejects(retry.save(), /disk/)
  assert.equal(retry.readContent(), 'unsaved')
  assert.equal(retry.state.dirty, true)
})

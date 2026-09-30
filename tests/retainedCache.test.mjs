import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retainedCache } from '../app/utils/retainedCache.ts'

test('缓存优先淘汰最久未使用项，当前显示和运行中任务不会被清理', () => {
  const values = new Map(),
    running = new Set(['job'])
  const cache = retainedCache(values, {
    entries: 2,
    weight: 10,
    measure: (x) => x.length,
    disposable: (key) => !running.has(key),
  })
  const release = cache.retain('current')
  for (const key of ['old', 'current', 'job', 'recent']) {
    values.set(key, 'aaa')
    cache.touch(key)
  }
  cache.prune()
  assert.deepEqual([...values.keys()], ['current', 'job'])
  values.set('next', 'aaa')
  cache.touch('next')
  cache.prune('next')
  assert.equal(values.size, 3)
  release()
  assert.deepEqual([...values.keys()], ['job', 'next'])
  release()
  assert.equal(values.size, 2)
})
test('缓存按文本容量清理，多个使用者释放前持续保留', () => {
  const values = new Map([
    ['a', 'aaaaaa'],
    ['b', 'bbbbbb'],
  ])
  const cache = retainedCache(values, { entries: 10, weight: 8, measure: (x) => x.length, disposable: () => true })
  const first = cache.retain('a'),
    second = cache.retain('a')
  cache.touch('b')
  first()
  assert.equal(values.has('a'), true)
  assert.equal(values.has('b'), false)
  values.set('c', 'cccccc')
  cache.touch('c')
  second()
  assert.deepEqual([...values.keys()], ['c'])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { courseTreeRows } from '../app/utils/courseTreeRows.ts'
test('大目录只平铺已展开分支，顺序、深度和稳定路径保留', () => {
  const children = Array.from({ length: 2000 }, (_, i) => ({ kind: 'video', path: `chapter/${i}.mp4` }))
  const folder = { kind: 'folder', path: 'chapter', children, videoCount: 2000 }
  const root = { kind: 'folder', path: '', children: [folder, { kind: 'video', path: 'end.mp4' }], videoCount: 2001 }
  assert.deepEqual(
    courseTreeRows(root, new Set()).map((row) => row.key),
    ['chapter', 'end.mp4'],
  )
  const rows = courseTreeRows(root, new Set(['chapter']))
  assert.equal(rows.length, 2002)
  assert.equal(rows[2000].node.path, 'chapter/1999.mp4')
  assert.equal(rows[2000].depth, 1)
  assert.equal(rows.at(-1).depth, 0)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogLocation, filterCourseCatalog } from '../app/utils/courseCatalog.ts'

const video = (path) => ({ kind: 'video', path, name: path.split('/').at(-1), title: path })
const folder = (path, children) => ({ kind: 'folder', path, children, name: path.split('/').at(-1) })

test('课节定位按每层目录单独翻页，根目录文件和嵌套文件都保留路径', () => {
  const children = Array.from({ length: 14 }, (_, i) => folder(`目录${i}`, [video(`目录${i}/一.mp4`)]))
  children[13].children = Array.from({ length: 14 }, (_, i) =>
    folder(`目录13/小节${i}`, [video(`目录13/小节${i}/一.mp4`)]),
  )
  children[13].children[13].children = Array.from({ length: 26 }, (_, i) => video(`目录13/小节13/${i}.mp4`))
  children.push(video('根目录.mp4'))
  const paths = new Set()
  function collect(node) {
    if (node.kind === 'video') paths.add(node.path)
    else node.children.forEach(collect)
  }
  const root = folder('', children)
  collect(root)
  const tree = filterCourseCatalog(root, paths, {})
  assert.deepEqual(catalogLocation(tree, '目录13/小节13/25.mp4', 12), [
    { folder: '', page: 2 },
    { folder: '目录13', page: 2 },
    { folder: '目录13/小节13', page: 3 },
  ])
  assert.deepEqual(catalogLocation(tree, '根目录.mp4', 12), [{ folder: '', page: 2 }])
  assert.equal(catalogLocation(tree, '目录1/小节13/25.mp4', 12), null)
  assert.equal(catalogLocation(tree, '目录13/小节13/不存在.mp4', 12), null)
})

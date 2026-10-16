import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { normalizeCourseName } from '../app/utils/courseLibrary.ts'

const replacements = {
  '~/composables/useProgress': 'export const useProgress = () => globalThis.courseIO.progress',
  '~/utils/fs': 'export const scanCourse = () => globalThis.courseIO.scan()',
  '~/utils/desktopFiles':
    'export const chooseCourseFolder = () => globalThis.courseIO.folder; export const fileMetadata = () => ({size:1,lastModified:1})',
  '~/utils/database':
    'export const databaseRequest = (...args) => globalThis.courseIO.request(...args); export const flushDatabaseWrites = async () => {}',
  '~/utils/dbClient':
    'export const dbFetchRecentCourses = () => globalThis.courseIO.recents(); export const dbSaveRecentCourse = (entry) => globalThis.courseIO.save(entry); export const dbFetchGuide = async () => ({metadata:{"lesson.mp4":{size:1,modified:1}}}); export const dbDeleteRecentCourse = async () => true',
  '~/utils/courseHandles':
    'export const readCourseHandles = async () => globalThis.courseIO.handles; export const saveCourseHandle = async (id,handle) => globalThis.courseIO.handles.set(id,handle)',
}
registerHooks({
  resolve(specifier, context, next) {
    if (replacements[specifier])
      return { url: 'data:text/javascript,' + encodeURIComponent(replacements[specifier]), shortCircuit: true }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})

async function fixture(t) {
  const course = {
    id: 'course',
    name: '原目录',
    sourceName: '原目录',
    videoCount: 1,
    lastOpenedAt: 1,
    lastVideoPath: 'lesson.mp4',
    status: 'active',
    pinned: false,
  }
  const folder = { name: '原目录', isSameEntry: async (other) => other === folder, isAvailable: async () => true }
  const writes = []
  let deleted = false
  const io = (globalThis.courseIO = {
    folder,
    failure: false,
    handles: new Map([['course', folder]]),
    progress: { ready: async () => {}, flush: async () => {}, courseProgress: () => ({}) },
    recents: () => [{ ...course }],
    scan: () => ({ tree: {}, videos: [{ path: 'lesson.mp4', title: '第一课', index: 0, handle: {} }] }),
    save: async (entry) => {
      writes.push(entry)
      if (deleted && !entry.restore) return false
      deleted = false
      course.sourceName = entry.name
      return true
    },
    request: async (endpoint, options = {}) => {
      assert.equal(endpoint, 'library')
      if (options.method && io.failure) throw Error('模拟写入失败')
      if (options.method === 'POST') Object.assign(course, options.body)
      if (options.method === 'DELETE') deleted = true
      if (options.method) return { success: true }
      if (options.query?.id) return deleted && !options.query.includeDeleted ? null : { ...course }
      return deleted ? [] : [{ ...course }]
    },
  })
  const { useCourseStore } = await import(`../app/composables/useCourseStore.ts?case=${crypto.randomUUID()}`)
  const store = useCourseStore()
  await store.initialize()
  t.after(() => {
    delete globalThis.courseIO
  })
  return { store, io, course, folder, writes }
}

test('重命名同步课程、最近打开和当前课程，重新扫描仍保留新名称', async (t) => {
  const { store, folder, writes } = await fixture(t)
  assert.equal(await store.loadCourse(folder), true)
  assert.equal(await store.renameCourse('course', '  新课程  '), '新课程')
  for (const entry of [store.state.course, store.state.accessRecent, ...store.state.recents, ...store.state.library])
    assert.equal(entry.name, '新课程')
  assert.equal(await store.loadCourse(folder), true)
  assert.equal(store.state.course.name, '新课程')
  assert.equal(writes.at(-1).name, '原目录')
  assert.equal(store.state.library[0].sourceName, '原目录')
})

test('重命名后的重新关联仍验证原目录名称和课节信息', async (t) => {
  const { store, io, folder } = await fixture(t)
  await store.renameCourse('course', '显示名称')
  io.folder = { ...folder, name: '错误目录' }
  assert.equal(await store.reopenRecent(store.state.library[0], true), false)
  assert.match(store.state.error, /不一致/)
  io.folder = folder
  assert.equal(await store.reopenRecent(store.state.library[0], true), true)
  assert.equal(store.state.course.name, '显示名称')
})

test('删除移除全部入口并关闭当前课程，再导入沿用同一课程身份和名称', async (t) => {
  const { store, io, folder, writes } = await fixture(t)
  await store.loadCourse(folder)
  await store.renameCourse('course', '我的课程')
  await store.deleteCourse('course')
  assert.equal(store.state.course, null)
  assert.equal(store.state.currentVideo, null)
  assert.equal(store.state.accessRecent, null)
  assert.equal(store.state.library.length, 0)
  assert.equal(store.state.recents.length, 0)
  assert.equal(io.handles.get('course'), folder)
  assert.equal(await store.loadCourse(folder), true)
  assert.equal(store.state.course.id, 'course')
  assert.equal(store.state.course.name, '我的课程')
  assert.equal(writes.at(-1).restore, true)
})

test('保存或删除失败保留课程和名称，并释放操作状态', async (t) => {
  const { store, io, folder } = await fixture(t)
  await store.loadCourse(folder)
  io.failure = true
  await assert.rejects(store.renameCourse('course', '未保存名称'), /写入失败/)
  assert.equal(store.state.course.name, '原目录')
  assert.equal(store.state.recents[0].name, '原目录')
  assert.equal(store.state.loading, false)
  await assert.rejects(store.deleteCourse('course'), /写入失败/)
  assert.equal(store.state.library.length, 1)
  assert.equal(store.state.course.id, 'course')
  assert.equal(store.state.loading, false)
  io.failure = false
  await store.deleteCourse('course')
  assert.equal(store.state.library.length, 0)
})

test('名称去除首尾空格，拒绝空名称、控制字符和超长名称', () => {
  assert.equal(normalizeCourseName('  Python 进阶  '), 'Python 进阶')
  assert.equal(normalizeCourseName('课'.repeat(120)).length, 120)
  assert.equal(normalizeCourseName('🎓'.repeat(120)), '🎓'.repeat(120))
  for (const value of ['', '   ', '课'.repeat(121), '课程\n名称'])
    assert.throws(() => normalizeCourseName(value), /1–120/)
})

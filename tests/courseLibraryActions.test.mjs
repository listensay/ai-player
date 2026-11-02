import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import ts from 'typescript'

const source = readFileSync(new URL('../app/composables/useCourseLibraryActions.ts', import.meta.url), 'utf8')
  .replace("from 'vue'", `from '${import.meta.resolve('vue')}'`)
  .replace("import { useRouter } from 'vue-router'", 'const useRouter = () => globalThis.courseLibraryActionsIO.router')
  .replace(
    "import { useCourseStore } from './useCourseStore'",
    'const useCourseStore = () => globalThis.courseLibraryActionsIO.store',
  )
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { useCourseLibraryActions } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function fixture(t) {
  const entry = {
    course: { id: '课程 / A', name: '原课程', lastVideoPath: 'last.mp4', status: 'active', pinned: false },
  }
  const home = {
    courses: ref([entry]),
    refresh: async () => {
      io.refreshes++
    },
  }
  const io = { routes: [], refreshes: 0, updates: [], deleted: [], fail: false }
  globalThis.courseLibraryActionsIO = {
    router: { push: async (route) => io.routes.push(route) },
    store: {
      state: { loading: false },
      async renameCourse(_id, value) {
        if (io.fail) throw Error('rename failed')
        return value.trim()
      },
      async deleteCourse(id) {
        if (io.fail) throw Error('delete failed')
        io.deleted.push(id)
      },
      async updateLibrary(id, patch) {
        io.updates.push([id, patch])
        return !io.fail
      },
    },
  }
  const actions = useCourseLibraryActions(home)
  t.after(() => {
    delete globalThis.courseLibraryActionsIO
  })
  return { home, io, actions, course: home.courses.value[0].course }
}
test('共用导航保留首页指定的继续课节与自动播放，查看和计划入口不串路由', async (t) => {
  const { actions, io, course } = fixture(t)
  await actions.go(course, 'player', 'recent.mp4')
  assert.deepEqual(io.routes.at(-1), {
    path: '/courses/%E8%AF%BE%E7%A8%8B%20%2F%20A/player',
    query: { autoplay: '1', lesson: 'recent.mp4' },
  })
  await actions.go(course, 'today')
  assert.deepEqual(io.routes.at(-1), { path: '/courses/%E8%AF%BE%E7%A8%8B%20%2F%20A', query: { panel: 'today' } })
  await actions.go(course)
  assert.deepEqual(io.routes.at(-1).query, {})
})
test('首页与课程库共用重命名、删除和状态更新，失败保留课程和可重试弹窗', async (t) => {
  const { home, io, actions, course } = fixture(t)
  actions.editCourse(course, 'rename')
  actions.draftName.value = ' 新课程 '
  await actions.submitCourseAction()
  assert.equal(course.name, '新课程')
  assert.equal(actions.courseAction.value, null)
  await actions.update(course, { pinned: true })
  assert.equal(course.pinned, true)
  io.fail = true
  await actions.update(course, { status: 'paused' })
  assert.equal(course.status, 'active')
  actions.editCourse(course, 'delete')
  await actions.submitCourseAction()
  assert.equal(home.courses.value.length, 1)
  assert.equal(actions.courseAction.value, 'delete')
  assert.equal(actions.actionError.value, 'delete failed')
  io.fail = false
  await actions.submitCourseAction()
  assert.equal(home.courses.value.length, 0)
  assert.deepEqual(io.deleted, [course.id])
})

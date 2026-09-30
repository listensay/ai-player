import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shallowRef } from 'vue'
import { createMemoryHistory, createRouter, isNavigationFailure } from 'vue-router'

// Only the native IPC boundary is replaced. Use real SQLite files, filesystem copies,
// Vue state, the production dbClient and actual router guards for the whole operation.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '~/utils/platform' || specifier === './platform') {
      return {
        url:
          'data:text/javascript,' +
          encodeURIComponent('export const desktopInvoke = (...args) => globalThis.flowIO(...args)'),
        shortCircuit: true,
      }
    }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { useNoteSession } = await import('../app/composables/useNoteSession.ts')
const { dbFetchNote, dbSaveNote } = await import('../app/utils/dbClient.ts')
const { protectNoteNavigation } = await import('../app/composables/useWorkspaceLifecycle.ts')
const { runAiBatches } = await import('../app/utils/aiBatchTask.ts')
const { createProgressStore } = await import('../app/composables/useProgress.ts')
const { createNoteImages } = await import('../app/utils/noteImages.ts')
const tick = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-player-flows-'))
  const file = join(directory, 'learning.db')
  let db = new DatabaseSync(file)
  db.exec(readFileSync(new URL('../src-tauri/src/schema.sql', import.meta.url), 'utf8'))
  const faults = { read: false, write: false, copy: false, beforeWrite: null }
  const writes = [],
    sessions = []
  globalThis.flowIO = async (command, options) => {
    assert.equal(command, 'database_request')
    const { endpoint, method, query, body } = options
    if (method === 'GET' && faults.read) throw Error('simulated read failure')
    if (method === 'POST') {
      await faults.beforeWrite?.(endpoint, body)
      if (faults.write) throw Error('simulated disk failure')
    }
    if (endpoint === 'progress') {
      if (method === 'GET') {
        const data = {}
        for (const row of db.prepare('SELECT * FROM video_progress').all()) {
          ;(data[row.course_id] ??= {})[row.video_path] = {
            time: row.time,
            duration: row.duration,
            ratio: row.ratio,
            done: !!row.done,
            updatedAt: row.updated_at,
          }
        }
        return data
      }
      db.prepare('INSERT OR REPLACE INTO video_progress VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        body.courseId,
        body.path,
        body.time,
        body.duration,
        body.ratio,
        Number(body.done),
        Date.now(),
      )
      return { success: true }
    }
    if (endpoint === 'note-images') {
      if (method === 'GET')
        return db
          .prepare('SELECT * FROM note_images WHERE course_id=? AND video_path=? AND name=?')
          .all(query.courseId, query.videoPath, query.name)
      db.prepare('INSERT INTO note_images VALUES (?, ?, ?, ?, ?, ?)').run(
        crypto.randomUUID(),
        body.courseId,
        body.videoPath,
        body.name,
        body.dataBase64,
        Date.now(),
      )
      return { success: true }
    }
    if (endpoint === 'notes') {
      if (method === 'GET')
        return (
          db
            .prepare('SELECT content, updated_at AS updatedAt FROM notes WHERE course_id=? AND video_path=?')
            .get(query.courseId, query.videoPath) ?? { content: '', updatedAt: null }
        )
      db.prepare('INSERT OR REPLACE INTO notes VALUES (?, ?, ?, ?)').run(
        body.courseId,
        body.videoPath,
        body.content,
        Date.now(),
      )
      writes.push(body.content)
      return { success: true, updatedAt: Date.now() }
    }
    assert.equal(endpoint, 'settings')
    if (method === 'GET') {
      const row = db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(query.key)
      return row ? JSON.parse(row.value_json) : null
    }
    db.prepare('INSERT OR REPLACE INTO app_settings VALUES (?, ?, ?)').run(
      body.key,
      JSON.stringify(body.value),
      Date.now(),
    )
    return { success: true }
  }
  function note(path = 'a.mp4') {
    const copy = join(directory, `${path}.md`)
    const session = useNoteSession({
      read: () => dbFetchNote('course', path),
      readCopy: () => (existsSync(copy) ? readFile(copy, 'utf8') : Promise.resolve(null)),
      write: (content) => dbSaveNote('course', path, content),
      writeCopy: async (content) => {
        if (faults.copy) throw Error('read-only directory')
        await writeFile(copy, content)
      },
    })
    sessions.push(session)
    return session
  }
  t.after(async () => {
    faults.read = false
    faults.write = false
    faults.copy = false
    faults.beforeWrite = null
    for (const s of sessions) {
      await s.save().catch(() => {})
      s.dispose()
    }
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    note,
    faults,
    writes,
    directory,
    seedProgress: () =>
      db
        .prepare('INSERT INTO video_progress VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('course', 'a.mp4', 95, 100, 0.95, 1, 123),
    progress: () =>
      db.prepare('SELECT * FROM video_progress WHERE course_id=? AND video_path=?').get('course', 'a.mp4'),
    seed: (content) =>
      db.prepare('INSERT OR REPLACE INTO notes VALUES (?, ?, ?, ?)').run('course', 'a.mp4', content, 123),
    stored: () => db.prepare('SELECT content FROM notes WHERE video_path=?').get('a.mp4')?.content,
    checkpoints: () =>
      db
        .prepare('SELECT value_json FROM app_settings')
        .all()
        .map((r) => JSON.parse(r.value_json)),
    restart: () => {
      db.close()
      db = new DatabaseSync(file)
    },
  }
}
async function navigation(note) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/courses/:id/player', component: {} },
      { path: '/', component: {} },
    ],
  })
  await router.push('/courses/course/player?lesson=a.mp4')
  const notices = []
  protectNoteNavigation(router, shallowRef({ save: note.save, hasUnsavedChanges: () => note.state.dirty }), (message) =>
    notices.push(message),
  )
  return { router, notices }
}

test('笔记读取失败不导入旧副本、不开放编辑；重试恢复数据库中的最新内容', async (t) => {
  const f = fixture(t)
  f.seed('数据库中的新内容')
  await writeFile(join(f.directory, 'a.mp4.md'), '较旧副本')
  f.faults.read = true
  const note = f.note()
  await assert.rejects(note.load())
  note.edit('错误空白')
  await note.save()
  assert.equal(note.state.ready, false)
  assert.equal(f.stored(), '数据库中的新内容')
  assert.deepEqual(f.writes, [])
  f.faults.read = false
  await note.load()
  assert.equal(note.state.content, '数据库中的新内容')
})

test('清空过的笔记保持为空；只有不存在的记录才导入课程副本', async (t) => {
  const f = fixture(t)
  f.seed('')
  await writeFile(join(f.directory, 'a.mp4.md'), '不应复活的旧笔记')
  const empty = f.note()
  await empty.load()
  assert.equal(empty.state.content, '')
  assert.deepEqual(f.writes, [])
  await writeFile(join(f.directory, 'b.mp4.md'), '首次导入')
  const imported = f.note('b.mp4')
  await imported.load()
  assert.equal(imported.state.content, '首次导入')
  assert.deepEqual(f.writes, ['首次导入'])
})

test('编辑后立即切课等待在途保存和新修改，重开 SQLite 后恢复最后内容', async (t) => {
  const f = fixture(t),
    note = f.note()
  await note.load()
  const { router } = await navigation(note)
  const entered = deferred(),
    release = deferred()
  f.faults.beforeWrite = async () => {
    entered.resolve()
    await release.promise
  }
  note.edit('第一版')
  const firstSave = note.save()
  await entered.promise
  note.edit('最后一版')
  const move = router.push('/courses/course/player?lesson=b.mp4')
  await tick()
  assert.equal(router.currentRoute.value.query.lesson, 'a.mp4')
  release.resolve()
  await firstSave
  await move
  assert.deepEqual(f.writes, ['第一版', '最后一版'])
  assert.equal(await readFile(join(f.directory, 'a.mp4.md'), 'utf8'), '最后一版')
  assert.equal(router.currentRoute.value.query.lesson, 'b.mp4')
  f.restart()
  const reopened = f.note()
  await reopened.load()
  assert.equal(reopened.state.content, '最后一版')
})

test('保存失败阻止切课和返回首页，保留草稿；修复后同一操作成功', async (t) => {
  const f = fixture(t),
    note = f.note()
  await note.load()
  const { router, notices } = await navigation(note)
  note.edit('不能丢失')
  f.faults.write = true
  assert.equal(isNavigationFailure(await router.push('/')), true)
  assert.equal(note.state.content, '不能丢失')
  assert.equal(note.state.dirty, true)
  assert.equal(router.currentRoute.value.query.lesson, 'a.mp4')
  assert.match(notices[0], /无法离开/)
  f.faults.write = false
  await router.push('/')
  assert.equal(f.stored(), '不能丢失')
  assert.equal(note.state.dirty, false)
  assert.equal(router.currentRoute.value.path, '/')
})

test('课程副本不可写时主笔记仍保存，重试只补副本，不重复写数据库', async (t) => {
  const f = fixture(t),
    note = f.note()
  await note.load()
  note.edit('安全保存')
  f.faults.copy = true
  await note.save()
  assert.equal(f.stored(), '安全保存')
  assert.equal(note.state.dirty, false)
  assert.match(note.state.copyError, /副本/)
  f.faults.copy = false
  await note.save()
  assert.equal(await readFile(join(f.directory, 'a.mp4.md'), 'utf8'), '安全保存')
  assert.deepEqual(f.writes, ['安全保存'])
  assert.equal(note.state.copyError, '')
})

test('编辑器规范化与未修改的关闭不回写，随后仍能保存真实编辑', async (t) => {
  const f = fixture(t)
  f.seed('原始笔记')
  const note = f.note()
  await note.load()
  note.acceptEditorContent('原始笔记\n')
  await note.save()
  assert.deepEqual(f.writes, [])
  note.edit('真实修改')
  await note.save()
  assert.equal(f.stored(), '真实修改')
})

test('副本写入失败也会排空后续编辑，切课后数据库保留最后内容', async (t) => {
  const f = fixture(t),
    note = f.note()
  await note.load()
  const { router } = await navigation(note)
  const entered = deferred(),
    release = deferred()
  f.faults.beforeWrite = async () => {
    entered.resolve()
    await release.promise
  }
  f.faults.copy = true
  note.edit('第一版')
  const saving = note.save()
  await entered.promise
  note.edit('最后一版')
  const move = router.push('/courses/course/player?lesson=b.mp4')
  release.resolve()
  await saving
  await move
  assert.equal(note.state.dirty, false)
  assert.equal(f.stored(), '最后一版')
  assert.equal(router.currentRoute.value.query.lesson, 'b.mp4')
  assert.match(note.state.copyError, /副本/)
})

function task(identity, request, extra = {}) {
  return {
    identity,
    batches: ['a', 'b', 'c'],
    signal: new AbortController().signal,
    request,
    validate: (raw, batch) => {
      assert.equal(raw.text, batch)
      return raw.text
    },
    progress() {},
    ...extra,
  }
}
test('AI 第二批失败，关闭重开数据库后只请求剩余批次', async (t) => {
  const f = fixture(t),
    calls = []
  await assert.rejects(
    runAiBatches(
      task('restart', async (batch, index) => {
        calls.push(index)
        if (index === 1) throw Error('offline')
        return { text: batch }
      }),
    ),
  )
  assert.equal(f.checkpoints()[0].values.length, 1)
  f.restart()
  const fresh = await import('../app/utils/aiBatchTask.ts?restart')
  const result = await fresh.runAiBatches(
    task('restart', async (batch, index) => {
      calls.push(index)
      return { text: batch }
    }),
  )
  assert.deepEqual(result, ['a', 'b', 'c'])
  assert.deepEqual(calls, [0, 1, 1, 2])
})

test('AI 结果写盘失败可重存已获得的响应，不重复调用模型', async (t) => {
  const f = fixture(t),
    calls = []
  const options = task('storage-retry', async (batch, index) => {
    calls.push(index)
    return { text: batch }
  })
  f.faults.write = true
  await assert.rejects(runAiBatches(options), /保存失败/)
  f.faults.write = false
  await runAiBatches(options)
  assert.deepEqual(calls, [0, 1, 2])
  assert.equal(f.checkpoints()[0].values.length, 3)
})

test('取消后的迟到 AI 响应不落盘，材料或模型改变不会复用旧任务', async (t) => {
  const f = fixture(t),
    entered = deferred(),
    response = deferred(),
    controller = new AbortController()
  const running = runAiBatches(
    task(
      'cancel',
      async () => {
        entered.resolve()
        return response.promise
      },
      { signal: controller.signal },
    ),
  )
  await entered.promise
  controller.abort()
  response.resolve({ text: 'a' })
  await assert.rejects(running)
  assert.equal(f.checkpoints().length, 0)
  let requests = 0
  for (const identity of [
    { model: 'one', material: 'old' },
    { model: 'two', material: 'old' },
    { model: 'two', material: 'new' },
  ]) {
    await runAiBatches(
      task(identity, async (batch) => {
        requests++
        return { text: batch }
      }),
    )
  }
  assert.equal(requests, 9)
})

test('无法读取 AI 进度时不请求模型；无效批次不进入已完成记录', async (t) => {
  const f = fixture(t)
  f.faults.read = true
  let calls = 0
  await assert.rejects(
    runAiBatches(
      task('read-error', async (batch) => {
        calls++
        return { text: batch }
      }),
    ),
  )
  assert.equal(calls, 0)
  f.faults.read = false
  await assert.rejects(runAiBatches(task('invalid', async () => ({ text: '伪造的来源' }))))
  assert.equal(f.checkpoints().length, 0)
})

test('播放进度读取失败不开放修改，重试恢复原位置和完成标记', async (t) => {
  const f = fixture(t)
  f.seedProgress()
  f.faults.read = true
  const progress = createProgressStore()
  t.after(progress.dispose)
  await assert.rejects(progress.ready())
  progress.update('course', 'a.mp4', 0, 100)
  progress.markDone('course', 'a.mp4', false)
  await progress.flush()
  assert.equal(f.progress().time, 95)
  assert.equal(f.progress().done, 1)
  f.faults.read = false
  await progress.retry()
  assert.equal(progress.get('course', 'a.mp4').time, 95)
  assert.equal(progress.get('course', 'a.mp4').done, true)
})

test('播放进度保存失败保留队列，重试完成后才清除；重启后保留最新标记', async (t) => {
  const f = fixture(t),
    progress = createProgressStore()
  t.after(progress.dispose)
  await progress.ready()
  progress.update('course', 'a.mp4', 25, 100)
  f.faults.write = true
  await assert.rejects(progress.flush())
  assert.equal(progress.state.pendingCount, 1)
  progress.update('course', 'a.mp4', 98, 100)
  f.faults.write = false
  await progress.retry()
  assert.equal(progress.state.pendingCount, 0)
  f.restart()
  const reopened = createProgressStore()
  t.after(reopened.dispose)
  await reopened.ready()
  assert.equal(reopened.get('course', 'a.mp4').time, 98)
  assert.equal(reopened.get('course', 'a.mp4').done, true)
})

test('进度保存中的新修改不会被旧写入出队操作删除', async (t) => {
  const f = fixture(t),
    progress = createProgressStore()
  t.after(progress.dispose)
  await progress.ready()
  const entered = deferred(),
    release = deferred()
  f.faults.beforeWrite = async () => {
    entered.resolve()
    await release.promise
  }
  progress.update('course', 'a.mp4', 10, 100)
  const saving = progress.flush()
  await entered.promise
  progress.update('course', 'a.mp4', 35, 100)
  release.resolve()
  await saving
  assert.equal(f.progress().time, 35)
  assert.equal(progress.state.pendingCount, 0)
})

test('无需再次编辑也会自动重试播放进度保存', async (t) => {
  let calls = 0
  const progress = createProgressStore(
    { read: async () => ({}), write: async () => ++calls > 1 },
    { save: 1, retry: 5 },
  )
  t.after(progress.dispose)
  await progress.ready()
  progress.update('course', 'a.mp4', 10, 100)
  for (let i = 0; i < 40 && progress.state.pendingCount; i++) await new Promise((r) => setTimeout(r, 5))
  assert.equal(calls, 2)
  assert.equal(progress.state.pendingCount, 0)
  assert.equal(progress.state.error, '')
})

function directoryHandle(root) {
  return {
    getDirectoryHandle: async (name, options) => {
      const path = join(root, name)
      if (options?.create) await mkdir(path, { recursive: true })
      return directoryHandle(path)
    },
    getFileHandle: async (name, options) => {
      const path = join(root, name)
      if (!options?.create) await stat(path)
      return {
        getFile: async () => new File([await readFile(path)], name),
        createWritable: async () => {
          let data
          return {
            write: async (value) => {
              data = value instanceof Blob ? Buffer.from(await value.arrayBuffer()) : value
            },
            close: () => writeFile(path, data),
          }
        },
      }
    },
  }
}

test('新截图保存为短引用，重开后从图片表读取，旧 Base64 仍可显示', async (t) => {
  const f = fixture(t),
    target = { courseId: 'course', path: 'a.mp4', title: '含 空格的课节', parent: directoryHandle(f.directory) }
  const images = createNoteImages(target)
  t.after(images.dispose)
  const blob = new Blob([new Uint8Array(200_000).fill(13)], { type: 'image/png' })
  const reference = await images.save(blob, '00-01')
  assert.ok(reference.length < 200)
  assert.equal(reference.includes('data:'), false)
  assert.equal((await readFile(join(f.directory, decodeURIComponent(reference)))).length, 200_000)
  const second = await images.save(blob, '00-01')
  assert.notEqual(reference, second)
  f.restart()
  const reopened = createNoteImages(target)
  t.after(reopened.dispose)
  const rendered = await reopened.resolve(reference)
  assert.match(rendered, /^data:image\/png;base64,/)
  assert.equal(await reopened.resolve(rendered), rendered)
})

test('图片数据库写入失败不返回可插入的引用', async (t) => {
  const f = fixture(t),
    images = createNoteImages({
      courseId: 'course',
      path: 'a.mp4',
      title: '课节',
      parent: directoryHandle(f.directory),
    })
  t.after(images.dispose)
  f.faults.write = true
  await assert.rejects(images.save(new Blob(['image']), '00-01'), /图片保存失败/)
})

test('旧校验器保存的残缺 AI 批次重新校验后仅续跑无效部分', async (t) => {
  fixture(t)
  await runAiBatches(
    task('legacy-partial', async (batch, index) => ({ text: index === 1 ? '' : batch }), {
      validate: (raw) => raw.text,
    }),
  )
  const calls = []
  const result = await runAiBatches(
    task('legacy-partial', async (batch, index) => {
      calls.push(index)
      return { text: batch }
    }),
  )
  assert.deepEqual(result, ['a', 'b', 'c'])
  assert.deepEqual(calls, [1, 2])
})

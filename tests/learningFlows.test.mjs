import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
const { runAiBatches } = await import('../app/utils/aiBatchTask.ts')
const { createProgressStore } = await import('../app/composables/useProgress.ts')
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
  const writes = []
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
  t.after(async () => {
    faults.read = false
    faults.write = false
    faults.copy = false
    faults.beforeWrite = null
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
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
  progress.update('course', 'a.mp4', 100, 100, { ended: true })
  f.faults.write = false
  await progress.retry()
  assert.equal(progress.state.pendingCount, 0)
  f.restart()
  const reopened = createProgressStore()
  t.after(reopened.dispose)
  await reopened.ready()
  assert.equal(reopened.get('course', 'a.mp4').time, 100)
  assert.equal(reopened.get('course', 'a.mp4').done, true)
})

test('播放到 95% 或接近片尾仍未完成，保存重启后保留续播位置', async (t) => {
  const f = fixture(t),
    progress = createProgressStore()
  t.after(progress.dispose)
  await progress.ready()
  const duration = 19 * 60 + 43
  for (const time of [duration * 0.95, 18 * 60 + 50, duration * 0.98, duration - 0.01, duration]) {
    progress.update('course', 'a.mp4', time, duration)
    assert.equal(progress.get('course', 'a.mp4').done, false)
    assert.equal(progress.get('course', 'a.mp4').time, time)
    await progress.flush()
    assert.equal(f.progress().done, 0)
  }
  progress.update('course', 'a.mp4', 18 * 60 + 50, duration)
  await progress.flush()
  f.restart()
  const reopened = createProgressStore()
  t.after(reopened.dispose)
  await reopened.ready()
  assert.equal(reopened.get('course', 'a.mp4').time, 1130)
  assert.equal(reopened.get('course', 'a.mp4').ratio, 1130 / duration)
  assert.equal(reopened.get('course', 'a.mp4').done, false)
})

test('播放结束才自动完成，重播保留完成标记，重置后不再按比例完成', async (t) => {
  const f = fixture(t),
    progress = createProgressStore()
  t.after(progress.dispose)
  await progress.ready()
  progress.update('course', 'a.mp4', 99.99, 100, { ended: true })
  assert.equal(progress.get('course', 'a.mp4').done, true)
  progress.update('course', 'a.mp4', 5, 100)
  await progress.flush()
  assert.equal(f.progress().time, 5)
  assert.equal(f.progress().done, 1)
  progress.markDone('course', 'a.mp4', false)
  assert.equal(progress.get('course', 'a.mp4').time, 0)
  assert.equal(progress.get('course', 'a.mp4').done, false)
  progress.update('course', 'a.mp4', 98, 100)
  await progress.flush()
  assert.equal(f.progress().done, 0)
  progress.markDone('course', 'a.mp4', true)
  await progress.flush()
  assert.equal(f.progress().time, 100)
  assert.equal(f.progress().ratio, 1)
  assert.equal(f.progress().done, 1)
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

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const boundaries = {
  '~/utils/database': ['databaseRequest'],
  '~/utils/guideAi': ['requestGuideJson'],
  '~/utils/fs': ['writeTextFile'],
  '~/composables/useAsrService': ['useAsrService'],
}
registerHooks({
  resolve(specifier, context, next) {
    if (boundaries[specifier])
      return {
        url:
          'data:text/javascript,' +
          encodeURIComponent(
            boundaries[specifier]
              .map((name) => `export const ${name} = (...args) => globalThis.transcriptIO.${name}(...args)`)
              .join('\n'),
          ),
        shortCircuit: true,
      }
    if (specifier.startsWith('~/'))
      return next(new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
})
const { useTranscripts } = await import('../app/composables/useTranscripts.ts')
const { toSrt } = await import('../app/utils/transcript.ts')
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-player-transcript-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const database = new Map(),
    calls = [],
    flags = { failBatch: -1, failFile: false, partialBatch: -1 }
  globalThis.transcriptIO = {
    useAsrService: () => ({}),
    databaseRequest: async (endpoint, options) => {
      if (endpoint === 'ai-batch-cache') return { success: true }
      if (options.method === 'POST') {
        database.set(options.body.key, structuredClone(options.body.value))
        return
      }
      return database.get(options.query.key) ?? null
    },
    writeTextFile: async (_dir, name, content) => {
      if (flags.failFile) throw Error('目录暂时不可写')
      await writeFile(join(directory, name), content)
    },
    requestGuideJson: async (_, messages) => {
      const text = messages[0].content
      const { segments } = JSON.parse(text.slice(text.lastIndexOf('\n{') + 1))
      calls.push(segments[0].id)
      if (segments[0].id === flags.failBatch) throw Error('模型暂时不可用')
      return {
        items: (segments[0].id === flags.partialBatch ? segments.slice(1) : segments).map((s) => ({
          id: s.id,
          text: 'TypeScript',
        })),
      }
    },
  }
  const api = useTranscripts(),
    id = directory,
    video = { path: 'lesson.mp4', title: 'lesson', parent: {} }
  const state = api.get(id, video.path)
  Object.assign(state, {
    status: 'ready',
    fileName: 'lesson.srt',
    segments: Array.from({ length: 65 }, (_, id) => ({ id, start: id, end: id + 1, text: 'type script' })),
  })
  await writeFile(join(directory, 'lesson.srt'), toSrt(state.segments))
  const settings = { baseUrl: 'https://example.test', model: 'test', apiKey: '' }
  return {
    api,
    id,
    video,
    state,
    settings,
    flags,
    calls,
    content: () => readFile(join(directory, 'lesson.srt'), 'utf8'),
  }
}
test('字幕校对后续批次失败时原字幕和文件不变，重试从断点继续后一次应用', async (t) => {
  const f = await fixture(t),
    original = await f.content()
  f.flags.failBatch = 30
  await assert.rejects(f.api.refine(f.id, f.video, f.settings), /暂时不可用/)
  assert.equal(await f.content(), original)
  assert.ok(f.state.segments.every((s) => s.text === 'type script'))
  f.flags.failBatch = -1
  const result = await f.api.refine(f.id, f.video, f.settings)
  assert.deepEqual(f.calls, [0, 30, 30, 60])
  assert.equal(result.changed, 65)
  assert.match(await f.content(), /TypeScript/)
  assert.ok(f.state.segments.every((s) => s.text === 'TypeScript'))
})
test('字幕文件保存失败后重试只写文件，不重复校对', async (t) => {
  const f = await fixture(t)
  f.flags.failFile = true
  await assert.rejects(f.api.refine(f.id, f.video, f.settings), /不可写/)
  assert.ok(f.state.segments.every((s) => s.text === 'type script'))
  f.flags.failFile = false
  await f.api.refine(f.id, f.video, f.settings)
  assert.deepEqual(f.calls, [0, 30, 60])
  assert.match(await f.content(), /TypeScript/)
})

test('AI 漏句不会提交残缺校对，重试仅重做未通过批次', async (t) => {
  const f = await fixture(t),
    original = await f.content()
  f.flags.partialBatch = 30
  await assert.rejects(f.api.refine(f.id, f.video, f.settings), /不完整/)
  assert.equal(await f.content(), original)
  f.flags.partialBatch = -1
  await f.api.refine(f.id, f.video, f.settings)
  assert.deepEqual(f.calls, [0, 30, 30, 60])
})

test('逐字稿缓存淘汰旧课节，但保留当前课节和待恢复的失败任务', async (t) => {
  const f = await fixture(t),
    release = f.api.retain(f.id, f.video.path)
  t.after(release)
  const old = f.api.get(f.id, 'old.mp4')
  old.status = 'ready'
  const failed = f.api.get(f.id, 'failed.mp4')
  failed.status = 'error'
  failed.segments = [{ id: 0, text: '尚未保存', start: 0, end: 1 }]
  for (let i = 0; i < 20; i++) f.api.get(f.id, `next-${i}.mp4`).status = 'ready'
  assert.equal(f.api.get(f.id, f.video.path), f.state)
  assert.equal(f.api.get(f.id, 'failed.mp4'), failed)
  assert.notEqual(f.api.get(f.id, 'old.mp4'), old)
})

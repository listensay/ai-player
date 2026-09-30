import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncRuntime } from '../scripts/runtime-cache.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ai-player-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'),
    output = join(root, 'runtime')
  await mkdir(source)
  await writeFile(join(source, 'node'), 'binary')
  await chmod(join(source, 'node'), 0o755)
  await writeFile(join(source, 'server.js'), 'one')
  const options = {
    output,
    trees: [{ source, destination: '' }],
    identity: { platform: process.platform, arch: process.arch, version: 1 },
  }
  return { source, output, options }
}
test('运行环境复用不变文件，只同步修改并移除过期文件', async (t) => {
  const f = await fixture(t)
  assert.equal((await syncRuntime(f.options)).copied, 2)
  const before = (await stat(join(f.output, 'node'))).mtimeMs
  assert.deepEqual(await syncRuntime(f.options), { copied: 0, reused: 2, removed: 0 })
  await writeFile(join(f.source, 'server.js'), 'two')
  assert.deepEqual(await syncRuntime(f.options), { copied: 1, reused: 1, removed: 0 })
  assert.equal((await stat(join(f.output, 'node'))).mtimeMs, before)
  if (process.platform !== 'win32') assert.equal((await stat(join(f.output, 'node'))).mode & 0o777, 0o755)
  await rm(join(f.source, 'server.js'))
  assert.deepEqual(await syncRuntime(f.options), { copied: 0, reused: 1, removed: 1 })
})
test('运行环境输出缺失或被修改时自动修复，身份变化后重建', async (t) => {
  const f = await fixture(t)
  await syncRuntime(f.options)
  await writeFile(join(f.output, 'server.js'), 'bad')
  await rm(join(f.output, 'node'))
  assert.equal((await syncRuntime(f.options)).copied, 2)
  assert.equal(await readFile(join(f.output, 'server.js'), 'utf8'), 'one')
  assert.equal((await syncRuntime({ ...f.options, identity: { ...f.options.identity, version: 2 } })).copied, 2)
})
test('准备失败不发布成功清单，修复源文件后可继续', async (t) => {
  const f = await fixture(t)
  await syncRuntime(f.options)
  const previous = await readFile(join(f.output, 'manifest.json'), 'utf8')
  const options = { ...f.options, files: [{ source: join(f.source, 'missing'), destination: 'dependency' }] }
  await assert.rejects(syncRuntime(options))
  assert.equal(await readFile(join(f.output, 'manifest.json'), 'utf8'), previous)
  await writeFile(join(f.source, 'missing'), 'fixed')
  await syncRuntime(options)
  assert.equal(await readFile(join(f.output, 'dependency'), 'utf8'), 'fixed')
})

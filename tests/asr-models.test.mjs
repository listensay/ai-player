import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, rm, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { download, downloadState, extractTarBz2 } from '../asr-server/models.mjs'

test('模型下载失败清理临时文件，重试以完整文件替换并更新进度', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-player-model-test-'))
  let fail = true
  const server = http.createServer((_req, res) => { if (fail) { res.writeHead(503); res.end() } else res.end('complete model') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dest = join(dir, 'model.onnx')
  try {
    await writeFile(dest, 'existing model')
    await assert.rejects(download(`http://127.0.0.1:${server.address().port}`, dest, 'model'), /503/)
    assert.equal(await readFile(dest, 'utf8'), 'existing model')
    await assert.rejects(access(`${dest}.part`))
    fail = false
    await download(`http://127.0.0.1:${server.address().port}`, dest, 'model')
    assert.equal(await readFile(dest, 'utf8'), 'complete model')
    assert.equal(downloadState.received, 14)
    assert.equal(downloadState.active, false)
    assert.equal(downloadState.error, '')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }) }
})

test('模型包使用随包解压器，损坏压缩包可报告失败', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-player-extract-test-'))
  try {
    await writeFile(join(dir, 'bad.tar.bz2'), 'bad archive')
    await assert.rejects(extractTarBz2(join(dir, 'bad.tar.bz2'), dir))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

// A small tar.bz2 fixture keeps the runtime test independent of the system tar command.
test('模型压缩包可在无需系统解压程序的环境中解压', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-player-valid-model-'))
  try {
    const archive = join(dir, 'model.tar.bz2')
    await writeFile(archive, Buffer.from('QlpoOTFBWSZTWePurgMAAHjbgMqAwAH9AEAAZyefQAgIIAB1Eao0DQPUZqBk9NQJJR6gaAAAB97AiQgydCEW8tMXQnlQIYGNtGLHE7CErBQJxxzJyXBqSUQManNBOyXj1Ue3sTU3b58eAEH4u5IpwoSHH3VwGA==', 'base64'))
    await extractTarBz2(archive, dir)
    assert.equal(await readFile(join(dir, 'model/model.onnx'), 'utf8'), 'valid model fixture')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

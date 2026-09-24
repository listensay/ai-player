import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, access } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

const runtime = path.resolve('src-tauri/runtime')
const platformPackage = `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
const libraries = path.join(runtime, 'node_modules', platformPackage)
const audio = path.join(os.homedir(), '.ai-player/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/test_wavs/zh.wav')

test('打包运行环境独立启动、鉴权、本地文件转写和任务取消', { timeout: 90000 }, async () => {
  await access(audio)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-player-runtime-test-'))
  const token = 'local-integration-test-token'
  const child = spawn(path.join(runtime, process.platform === 'win32' ? 'node.exe' : 'node'), [path.join(runtime, 'asr-server/server.mjs')], {
    cwd: dir, env: { ...process.env, PATH: process.platform === 'win32' ? libraries : '/usr/bin:/bin', DYLD_LIBRARY_PATH: libraries, LD_LIBRARY_PATH: libraries,
      ASR_PORT: '0', ASR_TOKEN: token, AI_PLAYER_MODEL_DIR: path.join(dir, 'models'), AI_PLAYER_FFMPEG: path.join(runtime, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = '', port = 0
  child.stdout.on('data', chunk => { logs += chunk; const match = /"event":"listening","port":(\d+)/.exec(logs); if (match) port = Number(match[1]) })
  child.stderr.on('data', chunk => { logs += chunk })
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  try {
    for (let i = 0; i < 200 && !port && child.exitCode === null; i++) await delay(100)
    assert.ok(port, logs)
    const url = `http://127.0.0.1:${port}`
    assert.equal((await fetch(`${url}/health`)).status, 401)
    let health
    for (let i = 0; i < 200; i++) {
      health = await (await fetch(`${url}/health`, { headers })).json()
      if (['ready', 'error'].includes(health.status)) break
      await delay(100)
    }
    assert.equal(health.status, 'ready', JSON.stringify(health))
    const result = await fetch(`${url}/transcribe-local`, { method: 'POST', headers, body: JSON.stringify({ path: audio, duration: 10, jobId: 'speech' }) })
    assert.equal(result.status, 200)
    const events = await result.text()
    assert.match(events, /event: done/)
    assert.match(events, /开饭时间/)
    // Cancellation arriving before the queued request must not start recognition.
    await fetch(`${url}/cancel`, { method: 'POST', headers, body: JSON.stringify({ jobId: 'cancelled' }) })
    const cancelled = await fetch(`${url}/transcribe-local`, { method: 'POST', headers, body: JSON.stringify({ path: audio, duration: 10, jobId: 'cancelled' }) })
    assert.doesNotMatch(await cancelled.text(), /event: done|event: segment/)
    const failed = await fetch(`${url}/transcribe-local`, { method: 'POST', headers, body: JSON.stringify({ path: path.join(dir, 'missing.mp4'), jobId: 'missing' }) })
    assert.match(await failed.text(), /event: error/)
  } finally {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000).then(() => child.kill('SIGKILL'))])
    await rm(dir, { recursive: true, force: true })
  }
})

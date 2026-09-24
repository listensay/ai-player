/**
 * 本机语音转文字服务（只监听 127.0.0.1）。
 *
 *   GET  /health       服务与模型状态
 *   POST /transcribe   请求体 = 视频/音频文件原始字节；响应为 SSE 事件流：
 *                        ready    { duration }          （音频解码开始）
 *                        segment  { id, start, end, text }
 *                        progress { seconds, ratio }
 *                        done     { duration, language, segments, elapsed }
 *                        error    { message }
 *
 * 一次只处理一个任务，其余排队；客户端断开会中止 ffmpeg 与识别。
 */
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { decodeToPcm } from './audio.mjs'
import { engineInfo, loadRecognizer, transcribePcm } from './engine.mjs'
import { MODEL_DIR, downloadState, ensureModels, modelsReady } from './models.mjs'

const PORT = Number(process.env.ASR_PORT || 8765)
const HOST = '127.0.0.1'
const TOKEN = process.env.ASR_TOKEN || ''
const controllers = new Map()
const cancelled = new Set()

async function readJson(req) {
  let body = ''
  for await (const chunk of req) { body += chunk; if (body.length > 16_384) throw new Error('请求内容过大') }
  return JSON.parse(body)
}
function authorized(req) {
  if (!TOKEN) return true
  const actual = Buffer.from(req.headers.authorization || '')
  const expected = Buffer.from(`Bearer ${TOKEN}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const log = (...args) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...args)

/* ---------- 模型准备（后台进行，不阻塞 /health） ---------- */
let modelState = { status: 'checking', error: '' } // checking | downloading | loading | ready | error

async function prepare() {
  try {
    if (!(await modelsReady())) {
      modelState = { status: 'downloading', error: '' }
      await ensureModels(log)
    }
    modelState = { status: 'loading', error: '' }
    await loadRecognizer()
    modelState = { status: 'ready', error: '' }
    log('识别器就绪')
  } catch (err) {
    modelState = { status: 'error', error: err.message }
    console.error('模型准备失败：', err.message)
  }
}

/* ---------- 单任务队列 ---------- */
let queue = Promise.resolve()
let queued = 0
function enqueue(task) {
  queued++
  const run = queue.then(task, task).finally(() => queued--)
  queue = run.catch(() => {})
  return run
}

/* ---------- HTTP ---------- */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name, X-Duration')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  return (event, data) => {
    if (res.writableEnded || res.destroyed) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}

async function handleTranscribe(req, res, local = null) {
  if (modelState.status !== 'ready') {
    return json(res, 503, { error: modelState.status === 'error' ? modelState.error : '模型尚未就绪，请稍后重试' })
  }

  const fileName = local ? path.basename(local.path) : decodeURIComponent(req.headers['x-file-name'] || 'input')
  const declaredDuration = Number(local?.duration ?? req.headers['x-duration'] ?? 0) || 0
  const url = new URL(req.url, 'http://localhost')
  const minSilence = Number(url.searchParams.get('minSilence')) || undefined
  const maxSegment = Number(url.searchParams.get('maxSegment')) || undefined

  const tmpDir = local ? null : await mkdtemp(path.join(os.tmpdir(), 'ai-player-asr-'))
  const tmpFile = local?.path ?? path.join(tmpDir, 'input' + (path.extname(fileName) || '.bin'))
  const cleanup = async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); if (local) controllers.delete(local.jobId) }
  const controller = new AbortController()
  if (local) { controllers.set(local.jobId, controller); if (cancelled.delete(local.jobId)) controller.abort() }
  // 注意：req 的 close 在请求体接收完就会触发，不能用它判断客户端断开；
  // 要看响应端：连接在我们主动结束之前就关了，才是客户端取消。
  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })

  try {
    if (!local) await pipeline(req, createWriteStream(tmpFile))
  } catch (err) {
    await cleanup()
    if (!res.headersSent) json(res, 400, { error: `接收文件失败：${err.message}` })
    return
  }
  if (controller.signal.aborted) {
    await cleanup()
    res.end()
    return
  }

  const send = sse(res)
  controller.signal.addEventListener('abort', () => res.end(), { once: true })
  if (queued > 0) send('queued', { position: queued })

  await enqueue(async () => {
    if (controller.signal.aborted) {
      await cleanup()
      res.end()
      return
    }
    const started = Date.now()
    log(`开始转写：${fileName}${declaredDuration ? `（${Math.round(declaredDuration)}s）` : ''}`)
    const { chunks, kill } = decodeToPcm(tmpFile, { signal: controller.signal })
    send('ready', { duration: declaredDuration })
    let lastProgress = 0
    try {
      const summary = await transcribePcm(chunks, {
        signal: controller.signal,
        minSilence,
        maxSegment,
        onSegment: (seg) => send('segment', seg),
        onProgress: (seconds) => {
          // 每 2 秒音频报一次；知道总时长时，最后一块一定报（让进度条走到头）
          const isLast = declaredDuration > 0 && seconds >= declaredDuration
          if (seconds - lastProgress < 2 && !isLast) return
          lastProgress = seconds
          send('progress', {
            seconds,
            ratio: declaredDuration ? Math.min(0.999, seconds / declaredDuration) : null,
          })
        },
      })
      if (!controller.signal.aborted) {
        const elapsed = (Date.now() - started) / 1000
        log(`完成：${fileName}，${summary.segments} 句，音频 ${summary.duration.toFixed(0)}s，耗时 ${elapsed.toFixed(1)}s`)
        send('done', { ...summary, elapsed })
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error('转写失败：', err)
        send('error', { message: err.message })
      }
    } finally {
      kill()
      res.end()
      await cleanup()
    }
  })
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) return json(res, 401, { error: '未授权的转写请求' })
  if (!TOKEN) cors(res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }
  const { pathname } = new URL(req.url, 'http://localhost')

  if (req.method === 'GET' && pathname === '/health') {
    return json(res, 200, {
      ok: true,
      status: modelState.status,
      error: modelState.error,
      download: downloadState.active
        ? { file: downloadState.file, received: downloadState.received, total: downloadState.total }
        : null,
      queued,
      modelDir: MODEL_DIR,
      ...engineInfo(),
    })
  }

  if (TOKEN && req.method === 'POST' && pathname === '/cancel') {
    try {
      const { jobId } = await readJson(req)
      if (typeof jobId !== 'string' || jobId.length > 100) throw new Error('无效的任务')
      if (controllers.has(jobId)) controllers.get(jobId).abort()
      else { if (cancelled.size >= 1000) cancelled.clear(); cancelled.add(jobId) }
      return json(res, 200, { ok: true })
    } catch (err) { return json(res, 400, { error: err.message }) }
  }

  if (req.method === 'POST' && (pathname === '/transcribe' || (TOKEN && pathname === '/transcribe-local'))) {
    try {
      let local = null
      if (pathname === '/transcribe-local') {
        local = await readJson(req)
        if (typeof local.path !== 'string' || !path.isAbsolute(local.path) || typeof local.jobId !== 'string' || local.jobId.length > 100) throw new Error('无效的转写文件')
        if (controllers.has(local.jobId)) throw new Error('任务已存在')
      }
      await handleTranscribe(req, res, local)
    } catch (err) {
      console.error(err)
      if (!res.headersSent) json(res, 500, { error: err.message })
      else res.end()
    }
    return
  }

  json(res, 404, { error: 'not found' })
})

// 上传大文件时不要因为空闲超时被断开
server.requestTimeout = 0
server.headersTimeout = 60_000

server.listen(PORT, HOST, () => {
  const port = server.address().port
  if (TOKEN) console.log(JSON.stringify({ event: 'listening', port }))
  log(`AI Player 语音转文字服务已启动：http://${HOST}:${port}`)
  log(`模型目录：${MODEL_DIR}`)
  void prepare()
})

function shutdown() {
  for (const controller of controllers.values()) controller.abort()
  server.close()
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
server.on('error', err => { console.error(err.message); process.exit(1) })
if (process.env.AI_PLAYER_PARENT_PID) {
  const parent = Number(process.env.AI_PLAYER_PARENT_PID)
  setInterval(() => { try { process.kill(parent, 0) } catch { shutdown() } }, 2000).unref()
}

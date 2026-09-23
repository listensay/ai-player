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

async function handleTranscribe(req, res) {
  if (modelState.status !== 'ready') {
    return json(res, 503, { error: modelState.status === 'error' ? modelState.error : '模型还没准备好，请稍候' })
  }

  const fileName = decodeURIComponent(req.headers['x-file-name'] || 'input')
  const declaredDuration = Number(req.headers['x-duration'] || 0) || 0
  const url = new URL(req.url, 'http://localhost')
  const minSilence = Number(url.searchParams.get('minSilence')) || undefined
  const maxSegment = Number(url.searchParams.get('maxSegment')) || undefined

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ai-player-asr-'))
  const tmpFile = path.join(tmpDir, 'input' + (path.extname(fileName) || '.bin'))
  const controller = new AbortController()
  // 注意：req 的 close 在请求体接收完就会触发，不能用它判断客户端断开；
  // 要看响应端：连接在我们主动结束之前就关了，才是客户端取消。
  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })

  try {
    await pipeline(req, createWriteStream(tmpFile))
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true })
    if (!res.headersSent) json(res, 400, { error: `接收文件失败：${err.message}` })
    return
  }
  if (controller.signal.aborted) {
    await rm(tmpDir, { recursive: true, force: true })
    return
  }

  const send = sse(res)
  if (queued > 0) send('queued', { position: queued })

  await enqueue(async () => {
    if (controller.signal.aborted) {
      await rm(tmpDir, { recursive: true, force: true })
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
          if (seconds - lastProgress < 2 && seconds < declaredDuration) return
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
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
}

const server = http.createServer(async (req, res) => {
  cors(res)
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

  if (req.method === 'POST' && pathname === '/transcribe') {
    try {
      await handleTranscribe(req, res)
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
  log(`AI Player 语音转文字服务已启动：http://${HOST}:${PORT}`)
  log(`模型目录：${MODEL_DIR}`)
  void prepare()
})

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

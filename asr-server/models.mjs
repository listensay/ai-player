/**
 * 模型文件管理：定位、下载、解压。
 *
 * 默认放在 ~/.ai-player/models（可用 AI_PLAYER_MODEL_DIR 覆盖），所有项目共享，不进 git。
 * 下载源默认是 sherpa-onnx 的 GitHub Release；国内网络可以用 AI_PLAYER_MODEL_BASE_URL
 * 指向镜像，或者按 README 手动把文件放进模型目录。
 */
import { createReadStream } from 'node:fs'
import { x as extractTar } from 'tar'
import unbzip2 from 'unbzip2-stream'
import { createWriteStream } from 'node:fs'
import { access, mkdir, rename, rm, stat, cp, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

export const MODEL_DIR =
  process.env.AI_PLAYER_MODEL_DIR || path.join(os.homedir(), '.ai-player', 'models')

const BASE_URL =
  process.env.AI_PLAYER_MODEL_BASE_URL ||
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'

export const SENSE_VOICE_NAME = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17'
export const VAD_FILE = 'silero_vad.onnx'

export const paths = {
  senseVoiceDir: path.join(MODEL_DIR, SENSE_VOICE_NAME),
  senseVoiceModel: path.join(MODEL_DIR, SENSE_VOICE_NAME, 'model.int8.onnx'),
  senseVoiceTokens: path.join(MODEL_DIR, SENSE_VOICE_NAME, 'tokens.txt'),
  vad: path.join(MODEL_DIR, VAD_FILE),
}

/** 下载进度（给 /health 用） */
export const downloadState = {
  active: false,
  file: '',
  received: 0,
  total: 0,
  error: '',
}

async function exists(p) {
  try {
    await access(p)
    return (await stat(p)).size > 0
  } catch {
    return false
  }
}

export async function modelsReady() {
  const [a, b, c] = await Promise.all([
    exists(paths.senseVoiceModel),
    exists(paths.senseVoiceTokens),
    exists(paths.vad),
  ])
  return a && b && c
}

export async function download(url, dest, label) {
  downloadState.active = true
  downloadState.file = label
  downloadState.received = 0
  downloadState.total = 0
  downloadState.error = ''
  const part = `${dest}.part`
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${url}`)
    downloadState.total = Number(res.headers.get('content-length') || 0)
    const counter = new TransformStream({
      transform(chunk, controller) {
        downloadState.received += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), createWriteStream(part))
    await rename(part, dest)
  } catch (err) {
    downloadState.error = err.message
    await rm(part, { force: true })
    throw err
  } finally {
    downloadState.active = false
  }
}

export async function extractTarBz2(archive, cwd) {
  await pipeline(createReadStream(archive), unbzip2(), extractTar({ cwd, strict: true, filter: (_path, entry) => entry.type === 'File' || entry.type === 'Directory' }))
}

let ensuring = null

/** 保证模型就位；并发调用共享同一个下载任务 */
export function ensureModels(log = console.log) {
  if (!ensuring) {
    ensuring = (async () => {
      await mkdir(MODEL_DIR, { recursive: true })
      // Reuse an earlier web installation without changing its files.
      const legacy = path.join(os.homedir(), '.ai-player', 'models')
      if (legacy !== MODEL_DIR) {
        for (const file of [VAD_FILE, `${SENSE_VOICE_NAME}/model.int8.onnx`, `${SENSE_VOICE_NAME}/tokens.txt`]) {
          const dest = path.join(MODEL_DIR, file)
          if (!(await exists(dest)) && await exists(path.join(legacy, file))) {
            await mkdir(path.dirname(dest), { recursive: true })
            const pending = `${dest}.part`
            await cp(path.join(legacy, file), pending)
            await rename(pending, dest)
          }
        }
      }

      if (!(await exists(paths.vad))) {
        log(`下载 VAD 模型 -> ${paths.vad}`)
        await download(`${BASE_URL}/${VAD_FILE}`, paths.vad, VAD_FILE)
      }

      if (!(await exists(paths.senseVoiceModel)) || !(await exists(paths.senseVoiceTokens))) {
        const archive = path.join(MODEL_DIR, `${SENSE_VOICE_NAME}.tar.bz2`)
        if (!(await exists(archive))) {
          log(`下载 SenseVoice 模型（约 160MB）-> ${archive}`)
          await download(`${BASE_URL}/${SENSE_VOICE_NAME}.tar.bz2`, archive, `${SENSE_VOICE_NAME}.tar.bz2`)
        }
        log('解压模型…')
        const staging = await mkdtemp(path.join(MODEL_DIR, '.extract-'))
        try {
          await extractTarBz2(archive, staging)
          for (const file of ['model.int8.onnx', 'tokens.txt']) {
            const source = path.join(staging, SENSE_VOICE_NAME, file)
            if (!(await stat(source)).size) throw new Error('下载的模型不完整，请重试')
          }
          await mkdir(paths.senseVoiceDir, { recursive: true })
          for (const file of ['model.int8.onnx', 'tokens.txt']) await rename(path.join(staging, SENSE_VOICE_NAME, file), path.join(paths.senseVoiceDir, file))
        } finally {
          await rm(staging, { recursive: true, force: true })
          await rm(archive, { force: true })
        }
      }
      log('模型就绪')
    })().finally(() => {
      ensuring = null
    })
  }
  return ensuring
}

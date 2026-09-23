/**
 * 用 ffmpeg 把任意视频/音频解码成 16kHz 单声道 float32 PCM，按块异步产出。
 * 不需要用户安装 ffmpeg：ffmpeg-static 自带对应平台的二进制。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')

export const SAMPLE_RATE = 16000

/**
 * @param {string} inputPath
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {{ chunks: AsyncGenerator<Float32Array>, kill: () => void }}
 */
export function decodeToPcm(inputPath, opts = {}) {
  const proc = spawn(
    ffmpegPath,
    [
      '-v', 'error',
      '-nostdin',
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      '-f', 'f32le',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let stderr = ''
  proc.stderr.on('data', (d) => (stderr += d))

  const kill = () => {
    if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL')
  }
  opts.signal?.addEventListener('abort', kill, { once: true })

  async function* chunks() {
    // ffmpeg 输出的字节数不一定是 4 的倍数，跨块拼接
    let carry = Buffer.alloc(0)
    try {
      for await (const data of proc.stdout) {
        const buf = carry.length ? Buffer.concat([carry, data]) : data
        const usable = buf.length - (buf.length % 4)
        carry = buf.subarray(usable)
        if (usable === 0) continue
        // 拷贝一份对齐的 ArrayBuffer，Float32Array 要求 4 字节对齐
        const aligned = new Float32Array(usable / 4)
        const view = new DataView(aligned.buffer)
        for (let i = 0; i < usable; i += 4) view.setFloat32(i, buf.readFloatLE(i), true)
        yield aligned
      }
      const code = await new Promise((resolve) => {
        if (proc.exitCode !== null) resolve(proc.exitCode)
        else proc.once('exit', resolve)
      })
      if (code !== 0 && !opts.signal?.aborted) {
        const detail = stderr.trim()
        if (/does not contain any stream/i.test(detail)) {
          throw new Error('这个文件里没有音轨，无法转写。')
        }
        if (/Invalid data found|moov atom not found|EBML header parsing failed/i.test(detail)) {
          throw new Error('ffmpeg 无法识别这个文件，可能已损坏或不是音视频文件。')
        }
        throw new Error(`ffmpeg 解码失败（exit ${code}）：${detail.split('\n')[0] || '未知错误'}`)
      }
    } finally {
      kill()
    }
  }

  return { chunks: chunks(), kill }
}

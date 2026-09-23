/**
 * 识别引擎：silero VAD 切句 + SenseVoice 逐段识别。
 * 输入是 16kHz float32 PCM 的异步块流，输出带起止时间的句子。
 */
import { createRequire } from 'node:module'
import os from 'node:os'
import { paths } from './models.mjs'
import { SAMPLE_RATE } from './audio.mjs'

const require = createRequire(import.meta.url)
const sherpa = require('sherpa-onnx-node')

const WINDOW = 512
const NUM_THREADS = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)))

let recognizer = null

export function engineInfo() {
  return {
    engine: 'sherpa-onnx',
    model: 'SenseVoice (zh/en/ja/ko/yue, int8)',
    version: sherpa.version,
    threads: NUM_THREADS,
    loaded: !!recognizer,
  }
}

/** 加载一次，常驻内存（约 300MB） */
export async function loadRecognizer() {
  if (recognizer) return recognizer
  recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: paths.senseVoiceModel, language: 'auto', useInverseTextNormalization: 1 },
      tokens: paths.senseVoiceTokens,
      numThreads: NUM_THREADS,
      provider: 'cpu',
      debug: 0,
    },
  })
  return recognizer
}

function createVad(opts) {
  return new sherpa.Vad(
    {
      sileroVad: {
        model: paths.vad,
        threshold: 0.5,
        minSpeechDuration: 0.25,
        // 讲课时的停顿通常 0.4–0.8 秒；再长的句子按 maxSpeechDuration 强制切开
        minSilenceDuration: opts.minSilence ?? 0.5,
        maxSpeechDuration: opts.maxSegment ?? 15,
        windowSize: WINDOW,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      debug: false,
    },
    120,
  )
}

/** SenseVoice 偶尔会把 <|zh|> 之类的标签留在文本里，统一清掉 */
function cleanText(text) {
  return text.replace(/<\|[^|]*\|>/g, '').replace(/\s+/g, ' ').trim()
}

function normalizeLang(tag) {
  const m = /<\|([a-z]+)\|>/.exec(tag || '')
  return m ? m[1] : ''
}

/**
 * @param {AsyncIterable<Float32Array>} chunks
 * @param {{ onSegment: (seg) => void|Promise<void>, onProgress: (seconds: number) => void, signal?: AbortSignal, minSilence?: number, maxSegment?: number }} handlers
 */
export async function transcribePcm(chunks, handlers) {
  const rec = await loadRecognizer()
  const vad = createVad(handlers)
  let consumed = 0
  let index = 0
  const langCount = new Map()

  async function drain() {
    while (!vad.isEmpty()) {
      if (handlers.signal?.aborted) return
      const seg = vad.front()
      vad.pop()
      const start = seg.start / SAMPLE_RATE
      const end = start + seg.samples.length / SAMPLE_RATE
      const stream = rec.createStream()
      stream.acceptWaveform({ samples: seg.samples, sampleRate: SAMPLE_RATE })
      const result = await rec.decodeAsync(stream)
      const text = cleanText(result.text)
      if (!text) continue
      const lang = normalizeLang(result.lang)
      if (lang) langCount.set(lang, (langCount.get(lang) ?? 0) + 1)
      await handlers.onSegment({
        id: index++,
        start: Math.round(start * 100) / 100,
        end: Math.round(end * 100) / 100,
        text,
      })
    }
  }

  // 跨块时把不足一个窗口的采样留到下一块
  let carry = new Float32Array(0)
  for await (const chunk of chunks) {
    if (handlers.signal?.aborted) break
    let buf = chunk
    if (carry.length) {
      buf = new Float32Array(carry.length + chunk.length)
      buf.set(carry)
      buf.set(chunk, carry.length)
    }
    let i = 0
    for (; i + WINDOW <= buf.length; i += WINDOW) {
      vad.acceptWaveform(buf.subarray(i, i + WINDOW))
    }
    carry = buf.subarray(i)
    consumed += i
    await drain()
    handlers.onProgress(consumed / SAMPLE_RATE)
  }
  if (!handlers.signal?.aborted) {
    if (carry.length) {
      const padded = new Float32Array(WINDOW)
      padded.set(carry)
      vad.acceptWaveform(padded)
      consumed += carry.length
    }
    vad.flush()
    await drain()
    handlers.onProgress(consumed / SAMPLE_RATE)
  }

  let language = ''
  let best = 0
  for (const [lang, n] of langCount) if (n > best) (best = n), (language = lang)
  return { duration: consumed / SAMPLE_RATE, language, segments: index }
}

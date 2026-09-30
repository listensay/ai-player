import type { PracticeAttachment, PracticeAttachmentContent } from '../types/practice'
import { isRecord } from './guide.ts'
import { databaseRequest } from '~/utils/database'

export const PRACTICE_FILE_ACCEPT =
  '.py,.js,.jsx,.ts,.tsx,.vue,.html,.css,.scss,.java,.c,.h,.cpp,.hpp,.cs,.go,.rs,.swift,.kt,.kts,.php,.rb,.sh,.sql,.json,.yaml,.yml,.xml,.md,.txt,.r,.dart,.ipynb,.png,.jpg,.jpeg,.webp'
export const PRACTICE_FILE_LIMIT = 8
const CODE_BYTES = 256 * 1024,
  IMAGE_BYTES = 2 * 1024 * 1024
const codeExtensions = new Set(
  PRACTICE_FILE_ACCEPT.split(',').filter((ext) => !['.png', '.jpg', '.jpeg', '.webp'].includes(ext)),
)

export function validateAttachments(raw: unknown): PracticeAttachment[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > PRACTICE_FILE_LIMIT) throw new Error('每次作业最多上传 8 个文件。')
  const seen = new Set<string>()
  const result = raw.map((file) => {
    if (
      !isRecord(file) ||
      typeof file.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(file.id) ||
      seen.has(file.id) ||
      typeof file.name !== 'string' ||
      !file.name.trim() ||
      file.name.length > 200 ||
      !['code', 'image'].includes(String(file.kind)) ||
      typeof file.size !== 'number' ||
      !Number.isInteger(file.size) ||
      file.size <= 0 ||
      file.size > (file.kind === 'image' ? IMAGE_BYTES : CODE_BYTES) ||
      (file.kind === 'code' &&
        (typeof file.characters !== 'number' ||
          !Number.isInteger(file.characters) ||
          file.characters <= 0 ||
          file.characters > 40000))
    ) {
      throw new Error('作业文件信息无效。')
    }
    seen.add(file.id)
    return {
      id: file.id,
      name: file.name,
      kind: file.kind as PracticeAttachment['kind'],
      size: file.size,
      ...(file.kind === 'code' ? { characters: file.characters as number } : {}),
    }
  })
  if (result.filter((file) => file.kind === 'image').length > 4) throw new Error('每次作业最多上传 4 张图片。')
  if (result.reduce((sum, file) => sum + (file.characters ?? 0), 0) > 120000)
    throw new Error('本次代码总量超过 12 万字，请减少文件后提交。')
  return result
}

function base64(bytes: Uint8Array) {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}

async function imageContent(file: File): Promise<{ content: PracticeAttachmentContent; size: number }> {
  if (file.size > 10 * 1024 * 1024) throw new Error('单张原图不能超过 10 MB。')
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => header[i] === byte)
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255
  const webp =
    String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
  if (!png && !jpeg && !webp) throw new Error('文件内容不是有效的 PNG、JPEG 或 WebP 图片。')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode().catch(() => {
      throw new Error('图片无法读取，请选择 PNG、JPEG 或 WebP 图片。')
    })
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000)
      throw new Error('图片尺寸过大，请缩小后重试。')
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图片处理失败，请重试。')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('图片处理失败。'))), 'image/jpeg', 0.9),
    )
    if (blob.size > IMAGE_BYTES) throw new Error('图片处理后仍超过 2 MB，请缩小图片后重试。')
    return {
      content: { kind: 'image', mediaType: 'image/jpeg', data: base64(new Uint8Array(await blob.arrayBuffer())) },
      size: blob.size,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function readPracticeFile(
  file: File,
): Promise<{ attachment: PracticeAttachment; content: PracticeAttachmentContent }> {
  if (!file.name.trim() || file.name.length > 200 || !file.size) throw new Error('文件为空或名称过长。')
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  const id = crypto.randomUUID()
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    const { content, size } = await imageContent(file)
    return { attachment: { id, name: file.name, kind: 'image', size }, content }
  }
  if (!codeExtensions.has(ext)) throw new Error('请选择代码、文本文件或 PNG、JPEG、WebP 图片；暂不支持压缩包。')
  if (file.size > CODE_BYTES) throw new Error('单个代码文件不能超过 256 KB。')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
  } catch {
    throw new Error('代码文件需使用 UTF-8 编码。')
  }
  // Reject binary control bytes in files presented as source code.
  // eslint-disable-next-line no-control-regex
  if (!text.trim() || /[\u0000-\u0008\u000e-\u001f]/u.test(text)) throw new Error('文件不包含有效的代码或文本。')
  if (text.length > 40000) throw new Error('单个代码文件不能超过 4 万字。')
  return {
    attachment: { id, name: file.name, kind: 'code', size: file.size, characters: text.length },
    content: { kind: 'code', text },
  }
}

export function createPracticeAttachmentStore() {
  const cache = new Map<string, Promise<PracticeAttachmentContent>>()
  const key = (courseId: string, recordId: string, id: string) =>
    `practice-file:${JSON.stringify([courseId, recordId, id])}`
  async function save(
    courseId: string,
    recordId: string,
    attachment: PracticeAttachment,
    content: PracticeAttachmentContent,
  ) {
    const storageKey = key(courseId, recordId, attachment.id)
    await databaseRequest('settings', {
      method: 'POST',
      body: { key: storageKey, value: { version: 1, attachment, content } },
    })
    cache.set(storageKey, Promise.resolve(content))
  }
  async function load(
    courseId: string,
    recordId: string,
    attachment: PracticeAttachment,
  ): Promise<PracticeAttachmentContent> {
    const storageKey = key(courseId, recordId, attachment.id)
    let promise = cache.get(storageKey)
    if (!promise) {
      promise = databaseRequest<unknown>('settings', { query: { key: storageKey } }).then((raw) => {
        if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.content))
          throw new Error('作业文件缺失或损坏，请重新上传。')
        const saved = validateAttachments([raw.attachment])[0]!
        if (
          saved.id !== attachment.id ||
          saved.name !== attachment.name ||
          saved.kind !== attachment.kind ||
          saved.size !== attachment.size ||
          saved.characters !== attachment.characters
        )
          throw new Error('作业文件信息不一致，请重新上传。')
        const content = raw.content
        if (
          content.kind === 'code' &&
          attachment.kind === 'code' &&
          typeof content.text === 'string' &&
          content.text.length === attachment.characters &&
          content.text.trim() &&
          !content.text.includes('\0')
        )
          return { kind: 'code' as const, text: content.text }
        if (
          content.kind === 'image' &&
          attachment.kind === 'image' &&
          ['image/jpeg', 'image/png', 'image/webp'].includes(String(content.mediaType)) &&
          typeof content.data === 'string' &&
          content.data.length <= Math.ceil(IMAGE_BYTES / 3) * 4 &&
          /^[A-Za-z0-9+/]+={0,2}$/.test(content.data) &&
          content.data.length % 4 === 0 &&
          atob(content.data).length === attachment.size
        )
          return content as unknown as PracticeAttachmentContent
        throw new Error('作业文件内容无效，请重新上传。')
      })
      cache.set(storageKey, promise)
    }
    try {
      return await promise
    } catch (error) {
      cache.delete(storageKey)
      throw error
    }
  }
  return { save, load, clear: () => cache.clear() }
}

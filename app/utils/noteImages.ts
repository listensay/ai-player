import { dbFetchNoteImages, dbSaveNoteImage } from '~/utils/dbClient'
import { resolveRelativeFile, writeBlobFile } from '~/utils/fs'
import type { CourseDirectoryHandle } from '~/types/storage'

/** The document stores portable references; image bytes are loaded only when displayed. */
export function createNoteImages(target: {
  courseId: string
  path: string
  title: string
  parent: CourseDirectoryHandle
}) {
  const cache = new Map<string, Promise<string>>()
  const urls = new Set<string>()
  let disposed = false
  async function save(blob: Blob, baseName: string, ext = 'png') {
    const name = `${baseName}-${crypto.randomUUID()}.${ext}`
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    const dataBase64 = `data:${blob.type || 'image/png'};base64,${btoa(binary)}`
    const result = await dbSaveNoteImage({ courseId: target.courseId, videoPath: target.path, name, dataBase64 })
    if (!result.success) throw new Error('图片保存失败，请重试。')
    try {
      const dir = await target.parent.getDirectoryHandle(`${target.title}.assets`, { create: true })
      await writeBlobFile(dir, name, blob)
    } catch {
      /* The primary image is available even when the portable copy cannot be written. */
    }
    return `${encodeURIComponent(`${target.title}.assets`)}/${name}`
  }
  async function resolve(src: string): Promise<string> {
    // Legacy embedded images and external URLs must not trigger an image-table read.
    if (/^(?:data:|blob:|https?:)/i.test(src) || disposed) return src
    let decoded = src
    try {
      decoded = decodeURIComponent(src)
    } catch {
      /* Keep old unescaped paths readable. */
    }
    let job = cache.get(decoded)
    if (!job) {
      job = (async () => {
        const name = decoded.split('/').pop()
        if (name) {
          const [record] = await dbFetchNoteImages(target.courseId, target.path, name)
          if (record?.data_base64) return record.data_base64
        }
        const file = await resolveRelativeFile(target.parent, decoded)
        if (!file || disposed) throw new Error('图片暂不可用')
        const url = URL.createObjectURL(file)
        urls.add(url)
        return url
      })()
      cache.set(decoded, job)
    }
    try {
      return await job
    } catch {
      cache.delete(decoded)
      return src
    }
  }
  function dispose() {
    disposed = true
    for (const url of urls) URL.revokeObjectURL(url)
    urls.clear()
    cache.clear()
  }
  return { save, resolve, dispose }
}

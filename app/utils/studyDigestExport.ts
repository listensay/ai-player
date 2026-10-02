import { desktopInvoke } from './platform.ts'

/** Wrap by measured glyph width so CJK and long unbroken strings do not overflow. */
export function wrapDigestText(text: string, measure: (s: string) => number, width: number): string[] {
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = []
    let line = ''
    for (const glyph of paragraph) {
      if (line && measure(line + glyph) > width) {
        lines.push(line)
        line = ''
      }
      line += glyph
    }
    lines.push(line)
    return lines
  })
}
export async function exportStudyDigest(markdown: string, name: string, format: 'md' | 'png') {
  let bytes: number[]
  if (format === 'md') bytes = Array.from(new TextEncoder().encode(markdown))
  else {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw Error('当前环境不支持长图导出。')
    const font = '24px -apple-system, BlinkMacSystemFont, sans-serif'
    context.font = font
    const lines = wrapDigestText(
      markdown.replace(/^#{1,6} /gm, '').replace(/^> /gm, ''),
      (text) => context.measureText(text).width,
      920,
    )
    if (lines.length > 280) throw Error('报告过长，请改用 Markdown 导出。')
    canvas.width = 1080
    canvas.height = Math.max(720, 210 + lines.length * 40)
    context.fillStyle = '#fcf5ef'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#fc8846'
    context.fillRect(0, 0, canvas.width, 14)
    context.font = 'bold 24px -apple-system, sans-serif'
    context.fillText('PLAYBO / STUDY DIGEST', 80, 75)
    context.font = font
    context.fillStyle = '#302b28'
    lines.forEach((line, i) => context.fillText(line, 80, 140 + i * 40))
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(Error('长图生成失败。'))), 'image/png'),
    )
    bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
  }
  return desktopInvoke<boolean>('export_study_digest', { name: `${name}.${format}`, format, bytes })
}

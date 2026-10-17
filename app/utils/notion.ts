export interface NotionBounds {
  x: number
  y: number
  width: number
  height: number
  viewportHeight: number
}
export interface NotionTarget {
  key: string
  url: string
  bounds: NotionBounds
}

/** A native child view must never extend beyond the visible DOM slot. */
export function notionBounds(
  rect: { left: number; top: number; right: number; bottom: number },
  width: number,
  height: number,
  clips: Array<{ left: number; top: number; right: number; bottom: number }> = [],
): NotionBounds | null {
  const x = Math.max(0, Math.ceil(rect.left), ...clips.map((clip) => Math.ceil(clip.left))),
    y = Math.max(0, Math.ceil(rect.top), ...clips.map((clip) => Math.ceil(clip.top)))
  const right = Math.min(width, Math.floor(rect.right), ...clips.map((clip) => Math.floor(clip.right))),
    bottom = Math.min(height, Math.floor(rect.bottom), ...clips.map((clip) => Math.floor(clip.bottom)))
  if (![x, y, right, bottom].every(Number.isFinite) || right - x < 80 || bottom - y < 80) return null
  return { x, y, width: right - x, height: bottom - y, viewportHeight: height }
}

/** Serialize native mutations, coalesce resizing, and keep late creations hidden after navigation. */
export function createNotionViewController(io: {
  prepare: (key: string, url: string) => Promise<void>
  layout: (bounds: NotionBounds | null) => Promise<void>
}) {
  let desired: NotionTarget | null = null,
    revision = 0,
    signature = '',
    prepared = '',
    layout = ''
  let running: Promise<void> | undefined
  function update(target: NotionTarget | null, retry = false): Promise<void> {
    const next = JSON.stringify(target)
    if (!retry && signature === next) return running ?? Promise.resolve()
    signature = next
    desired = target
    revision++
    if (retry) prepared = ''
    if (running) return running
    running = (async () => {
      let handled = -1
      while (handled !== revision) {
        const token = revision,
          current = desired
        try {
          if (current) {
            const identity = JSON.stringify([current.key, current.url])
            if (identity !== prepared) {
              await io.layout(null)
              layout = 'null'
              await io.prepare(current.key, current.url)
              prepared = identity
            }
            if (token !== revision) continue
          }
          const bounds = current?.bounds ?? null,
            encoded = JSON.stringify(bounds)
          if (layout !== encoded) {
            await io.layout(bounds)
            layout = encoded
          }
          handled = token
        } catch (error) {
          layout = ''
          await io.layout(null).catch(() => {})
          if (token !== revision) continue
          signature = ''
          throw error
        }
      }
    })().finally(() => {
      running = undefined
    })
    return running
  }
  return { update }
}

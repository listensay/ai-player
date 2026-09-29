export interface CompanionHitRegion {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

/** Only painted controls receive native mouse input; the speech bubble is passive. */
export function companionHitRegions(root: HTMLElement): CompanionHitRegion[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-pet-hit]')).flatMap(element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    if (style.visibility !== 'visible' || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) return []
    return [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      radius: Math.min(rect.width, rect.height) * Number(element.dataset.petHit || 0) }]
  })
}

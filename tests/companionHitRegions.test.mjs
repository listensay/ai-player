import assert from 'node:assert/strict'
import { test } from 'node:test'
import { companionHitRegions } from '../app/utils/companionHitRegions.ts'

test('只同步可见操作的逻辑像素区域，隐藏关闭按钮和空节点不挡点击', (t) => {
  const original = globalThis.getComputedStyle
  globalThis.getComputedStyle = (element) => element.style
  t.after(() => {
    globalThis.getComputedStyle = original
  })
  const element = (style = {}, rect = {}, radius = '0.5') => ({
    style: { visibility: 'visible', opacity: '1', ...style },
    dataset: { petHit: radius },
    getBoundingClientRect: () => ({ x: 120, y: 360, width: 26, height: 24, ...rect }),
  })
  const controls = [element(), element({ visibility: 'hidden' }), element({ opacity: '0' }), element({}, { width: 0 })]
  const root = {
    querySelectorAll: (selector) => {
      assert.equal(selector, '[data-pet-hit]')
      return controls
    },
  }
  assert.deepEqual(companionHitRegions(root), [{ x: 120, y: 360, width: 26, height: 24, radius: 12 }])
  controls.push(element({}, { x: 42, y: 40, width: 196, height: 216 }, '0.08'))
  assert.equal(companionHitRegions(root).length, 2)
})

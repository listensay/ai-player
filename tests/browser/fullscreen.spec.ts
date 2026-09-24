import { test, expect, openCourse } from './fixtures'

test('视频可进入全屏、保持播放位置并通过 Esc 退出', async ({ page, desktop }) => {
  await openCourse(page)
  const video = page.locator('video')
  await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThan(0)
  await video.evaluate(v => { (v as HTMLVideoElement).currentTime = 15 })
  await page.getByRole('button', { name: '全屏（F）', exact: true }).click()
  await expect(page.locator('[data-fullscreen="true"]')).toBeVisible()
  await expect.poll(() => desktop.window.fullscreen).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-fullscreen="true"]')).toHaveCount(0)
  expect(desktop.window.fullscreen).toBe(false)
  expect(await video.evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(15)
  await page.keyboard.press('f')
  await expect(page.locator('[data-fullscreen="true"]')).toBeVisible()
  await page.getByRole('button', { name: '退出全屏（F）', exact: true }).click()
  await expect(page.locator('[data-fullscreen="true"]')).toHaveCount(0)
  expect(desktop.window.fullscreen).toBe(false)
})

test('窗口原本已全屏时，退出视频全屏后保持窗口全屏', async ({ page, desktop }) => {
  await openCourse(page)
  desktop.window.fullscreen = true
  await page.getByRole('button', { name: '全屏（F）', exact: true }).click()
  await expect(page.locator('[data-fullscreen="true"]')).toBeVisible()
  await page.getByRole('button', { name: '退出全屏（F）', exact: true }).click()
  await expect(page.locator('[data-fullscreen="true"]')).toHaveCount(0)
  expect(desktop.window.fullscreen).toBe(true)
})

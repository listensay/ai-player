import { test, expect, plan } from './fixtures'
import type { DesktopBackend } from './desktop'
import type { Page } from '@playwright/test'

const legacy = { baseUrl: 'https://alpha.test/v1', model: 'alpha-model', apiKey: 'test-alpha-key', timeoutMinutes: 25 }
const panel = (page: Page) => page.getByRole('region', { name: 'AI 配置管理', exact: true })
const guide = (page: Page) => page.getByRole('dialog', { name: 'AI 智能导学', exact: true })
const picker = (page: Page) => guide(page).getByLabel('当前使用的 AI', { exact: true })

/** 预置 SQLite 中的 AI 配置（早期单组格式），并提供读写失败模拟。 */
function setup(desktop: DesktopBackend) {
  desktop.course.duration = 60
  desktop.write('settings', { key: 'ai_settings', value: legacy })
  return {
    saved: () => desktop.read('settings', { key: 'ai_settings' }) as any,
    writes: () => desktop.settingWrites,
    failWrites: (fail: boolean) => { desktop.failures.settingsWrite = fail },
    failReads: (fail: boolean) => { desktop.failures.settingsRead = fail },
  }
}

async function openSettings(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '打开课程文件夹', exact: true }).click()
  await page.getByTitle('AI 智能导学与定制路线', { exact: true }).click()
  await guide(page).getByRole('button', { name: 'AI 设置', exact: true }).click()
  await expect(panel(page)).toBeVisible()
}

async function addBeta(page: Page) {
  await panel(page).getByRole('button', { name: '新增配置', exact: true }).click()
  await panel(page).getByLabel('配置名称', { exact: true }).fill('项目学习')
  await panel(page).getByLabel('服务地址', { exact: true }).fill('https://beta.test/v1')
  await panel(page).getByLabel('模型名称', { exact: true }).fill('beta-model')
  await panel(page).getByLabel('API 密钥', { exact: true }).fill('test-beta-key')
  await panel(page).getByLabel('响应超时时长（分钟）', { exact: true }).fill('7')
  await panel(page).getByRole('button', { name: '保存并使用', exact: true }).click()
  await expect(panel(page).getByRole('status')).toHaveText('配置已保存并启用。')
}

test('多 AI：迁移、添加、编辑、切换与刷新恢复，删除当前项后需重新选择', async ({ page, desktop }, testInfo) => {
  const db = setup(desktop)
  await openSettings(page)
  await expect(panel(page).getByLabel('配置名称', { exact: true })).toHaveValue('原有配置')
  await expect(panel(page).getByLabel('API 密钥', { exact: true })).toHaveValue(legacy.apiKey)
  await expect(panel(page).getByLabel('响应超时时长（分钟）', { exact: true })).toHaveValue('25')
  await addBeta(page)
  expect(db.saved().profiles).toHaveLength(2)
  const betaId = db.saved().activeId
  await picker(page).selectOption('legacy-default')
  await expect.poll(() => db.saved().activeId).toBe('legacy-default')
  await expect(panel(page).getByLabel('模型名称', { exact: true })).toHaveValue('alpha-model')
  await openSettings(page)
  await expect(picker(page)).toHaveValue('legacy-default')
  await expect(picker(page).locator('option')).toHaveCount(3)
  await panel(page).getByRole('button', { name: '编辑配置 项目学习', exact: true }).click()
  await panel(page).getByLabel('配置名称', { exact: true }).fill('项目学习（更新）')
  await panel(page).getByLabel('模型名称', { exact: true }).fill('beta-new')
  await panel(page).getByRole('button', { name: '保存并使用', exact: true }).click()
  await expect(picker(page)).toHaveValue(betaId)
  expect(db.saved().profiles).toHaveLength(2)
  expect(db.saved().profiles[0].apiKey).toBe(legacy.apiKey)
  await panel(page).getByRole('heading', { name: 'AI 服务配置', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('ai-profiles-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await panel(page).getByRole('heading', { name: 'AI 服务配置', exact: true }).scrollIntoViewIfNeeded()
  await expect.poll(() => guide(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('ai-profiles-mobile.png') })
  await panel(page).getByRole('button', { name: '删除配置', exact: true }).click()
  await panel(page).getByRole('button', { name: '取消删除', exact: true }).click()
  expect(db.saved().profiles).toHaveLength(2)
  await panel(page).getByRole('button', { name: '删除配置', exact: true }).click()
  await panel(page).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(picker(page)).toHaveValue('')
  expect(db.saved().profiles).toHaveLength(1)
  await panel(page).getByRole('button', { name: '删除配置', exact: true }).click()
  await panel(page).getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(panel(page).getByLabel('配置名称', { exact: true })).toHaveValue('')
  await openSettings(page)
  await expect(picker(page)).toBeDisabled()
  expect(db.saved()).toEqual({ version: 2, profiles: [], activeId: '' })
  await addBeta(page)
  expect(db.saved().profiles).toHaveLength(1)
  expect(db.saved().activeId).toBe(db.saved().profiles[0].id)
})

test('所选 AI 实际用于导学、出题与作答反馈，切换不混用模型和密钥', async ({ page, desktop }) => {
  const db = setup(desktop)
  const requests: Array<{ url: string; model: string; auth: string | undefined }> = []
  await page.route('https://*.test/v1/chat/completions', route => {
    const req = route.request(), body = req.postDataJSON()
    requests.push({ url: req.url(), model: body.model, auth: req.headers().authorization })
    const prompt = body.messages.at(-1).content
    const raw = prompt.includes('作答反馈') ? { result: 'solid', strengths: ['概念正确'], gaps: [], nextStep: '继续学习', sourceIds: ['s1'] }
      : prompt.includes('课后练习') ? { kind: 'explain', prompt: '解释反射的用途。', concepts: ['反射'], criteria: ['说明用途'], referenceAnswer: '运行时获取类信息。', sourceIds: ['s1'] } : plan()
    return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(raw) } }] } })
  })
  await openSettings(page)
  await addBeta(page)
  await panel(page).getByRole('button', { name: '返回定制路线', exact: true }).click()
  await guide(page).getByLabel('学习背景与目标', { exact: true }).fill('学习 Java，每天一小时。')
  await guide(page).getByRole('button', { name: '生成学习路线', exact: true }).click()
  await expect(guide(page).getByRole('heading', { name: '学习路线', exact: true })).toBeVisible()
  await picker(page).selectOption('legacy-default')
  await expect.poll(() => db.saved().activeId).toBe('legacy-default')
  await guide(page).getByLabel('继续补充或调整目标', { exact: true }).fill('重点学习框架原理。')
  await guide(page).getByRole('button', { name: '调整学习路线', exact: true }).click()
  await expect(guide(page).getByRole('button', { name: '调整学习路线', exact: true })).toBeEnabled()
  await guide(page).getByRole('button', { name: '开始学习', exact: true }).click()
  await expect(page.locator('video')).toBeVisible()
  await page.getByRole('button', { name: '课后练习', exact: true }).last().click()
  const practice = page.getByRole('dialog', { name: '课后练习', exact: true })
  await expect(practice.getByLabel('当前使用的 AI', { exact: true })).toHaveValue('legacy-default')
  await practice.getByLabel('当前使用的 AI', { exact: true }).selectOption({ label: '项目学习 · beta-model' })
  await practice.getByLabel('补充学习内容', { exact: true }).fill('反射可以在程序运行时读取类的信息，获取构造函数、字段和方法。通过反射创建实例并调用方法，需要处理参数类型以及访问权限。')
  await practice.getByRole('button', { name: '生成练习', exact: true }).click()
  await expect(practice.getByRole('heading', { name: '解释反射的用途。' })).toBeVisible()
  await practice.getByLabel('当前使用的 AI', { exact: true }).selectOption('legacy-default')
  await practice.getByLabel('作答内容', { exact: true }).fill('运行时获取类信息。')
  await practice.getByRole('button', { name: '提交作答', exact: true }).click()
  await expect(practice.getByLabel('答题反馈')).toBeVisible()
  expect(requests).toEqual([
    { url: 'https://beta.test/v1/chat/completions', model: 'beta-model', auth: 'Bearer test-beta-key' },
    { url: 'https://alpha.test/v1/chat/completions', model: 'alpha-model', auth: 'Bearer test-alpha-key' },
    { url: 'https://beta.test/v1/chat/completions', model: 'beta-model', auth: 'Bearer test-beta-key' },
    { url: 'https://alpha.test/v1/chat/completions', model: 'alpha-model', auth: 'Bearer test-alpha-key' },
  ])
})

test('保存和切换失败保留原配置，读取失败不覆盖数据库', async ({ page, desktop }) => {
  const db = setup(desktop)
  await openSettings(page)
  await addBeta(page)
  const before = JSON.stringify(db.saved()), active = db.saved().activeId
  db.failWrites(true)
  await picker(page).selectOption('legacy-default')
  await expect(panel(page).getByRole('alert')).toContainText('保存失败')
  await expect(picker(page)).toHaveValue(active)
  await panel(page).getByLabel('模型名称', { exact: true }).fill('not-saved')
  const beforeSave = db.writes()
  await panel(page).getByRole('button', { name: '保存并使用', exact: true }).click()
  // 切换失败时已显示同样的提示，需等待本次保存请求真正发出。
  await expect.poll(() => db.writes()).toBe(beforeSave + 1)
  await expect(panel(page).getByText('AI 配置保存失败，请重试。').last()).toBeVisible()
  expect(JSON.stringify(db.saved())).toBe(before)
  const writes = db.writes()
  db.failReads(true)
  await openSettings(page)
  await expect(panel(page).getByRole('alert')).toContainText('读取失败')
  await expect(panel(page).getByRole('button', { name: '新增配置', exact: true })).toBeDisabled()
  expect(db.writes()).toBe(writes)
  db.failReads(false); db.failWrites(false)
  await panel(page).getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(picker(page)).toHaveValue(active)
  await expect(panel(page).getByLabel('模型名称', { exact: true })).toHaveValue('beta-model')
})

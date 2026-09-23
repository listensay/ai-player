import { test as base, expect, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Chromium 的隐身上下文在反序列化 OPFS 句柄时会崩溃。
// 每项测试使用独立的临时常规配置，真实验证 IndexedDB 句柄与刷新恢复。
const test = base.extend({
  context: async ({ playwright, baseURL, viewport, channel }, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-player-e2e-'))
    const context = await playwright.chromium.launchPersistentContext(directory, { baseURL, viewport, channel })
    try { await use(context) }
    finally { await context.close(); await rm(directory, { recursive: true, force: true }) }
  },
})

const paths = ['01-Java基础.mp4', '02-反射.mp4', '03-注解.mp4', '04-多态.mp4', '05-SpringBoot.mp4', '06-项目实战.mp4']
const titles = paths.map(p => p.replace('.mp4', ''))
function plan() {
  return {
    summary: '为 SpringBoot 项目开发保留关键基础，其他基础按需查漏。', profile: '学过 Java，每天两小时，希望上手 SpringBoot。', dailyMinutes: 120,
    modules: [{ id: 'base', title: 'Java 基础与机制', description: '理解框架背后的语言机制' }, { id: 'project', title: 'SpringBoot 项目', description: '从框架到项目实战' }],
    lessons: paths.map((path, i) => ({ path, moduleId: i < 4 ? 'base' : 'project', concepts: [titles[i]!.split('-')[1]],
      prerequisites: i === 4 ? [paths[1], paths[2]] : [], status: i === 4 ? 'required' : i === 5 ? 'optional' : 'skipped', reason: i === 4 ? '直接服务项目开发目标' : '按已有基础与目标选取' })),
  }
}

async function seedLocalCourse(page: Page, duration = 120) {
  // 真正的浏览器文件句柄可写笔记、可存入 IndexedDB；只替换系统目录选择框。
  await page.addInitScript(({ paths, duration }) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      const courseName = localStorage.getItem('test-course-name') || '导学测试课程'
      const dir = await root.getDirectoryHandle(courseName, { create: true })
      const existing = await dir.getFileHandle(paths[0]!).catch(() => null)
      if (!existing) {
        // 有效 WAV 媒体；浏览器按内容解码，使用 .mp4 名称进入现有视频目录扫描。
        const samples = 8000 * duration, buffer = new ArrayBuffer(44 + samples), view = new DataView(buffer)
        const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
        text(0, 'RIFF'); view.setUint32(4, 36 + samples, true); text(8, 'WAVE'); text(12, 'fmt ')
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
        view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true)
        text(36, 'data'); view.setUint32(40, samples, true); new Uint8Array(buffer, 44).fill(128)
        for (const name of paths) {
          const file = await dir.getFileHandle(name, { create: true }), writer = await file.createWritable()
          await writer.write(buffer); await writer.close()
        }
        const subtitle = await dir.getFileHandle('04-多态.srt', { create: true }), writer = await subtitle.createWritable()
        await writer.write('1\n00:00:01,000 --> 00:00:10,000\n回顾类与继承。\n\n2\n00:00:20,000 --> 00:00:30,000\n多态通过运行时对象选择子类实现。\n')
        await writer.close()
      }
      return dir
    }
  }, { paths, duration })
}

async function openCourse(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '打开课程文件夹', exact: true }).click()
  await expect(page.getByRole('heading', { name: titles[0], exact: true })).toBeVisible()
}

async function configure(page: Page) {
  await page.getByRole('button', { name: 'AI 导学', exact: true }).click()
  await page.getByRole('button', { name: 'AI 设置', exact: true }).click()
  await page.getByLabel('服务地址', { exact: true }).fill('https://guide.test/v1')
  await page.getByLabel('模型名称', { exact: true }).fill('fixture-model')
  await page.getByLabel('API 密钥', { exact: true }).fill('only-for-this-test')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByRole('button', { name: '返回定制路线', exact: true }).click()
}

async function generate(page: Page) {
  await page.getByLabel('学习背景与目标', { exact: true }).fill('学过 Java，想速成 SpringBoot 开发项目，每天 2 小时。')
  await page.getByRole('button', { name: '生成我的路线', exact: true }).click()
  await expect(page.getByRole('heading', { name: '你的学习路线', exact: true })).toBeVisible()
}


export { test, expect, paths, titles, plan, seedLocalCourse, openCourse, configure, generate }

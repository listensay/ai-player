import { test as base, expect, type Page } from '@playwright/test'
import { DesktopBackend, type Reply } from './desktop'

const paths = ['01-Java基础.mp4', '02-反射.mp4', '03-注解.mp4', '04-多态.mp4', '05-SpringBoot.mp4', '06-项目实战.mp4']
const titles = paths.map(p => p.replace('.mp4', ''))
const subtitle = '1\n00:00:01,000 --> 00:00:10,000\n回顾类与继承。\n\n2\n00:00:20,000 --> 00:00:30,000\n多态通过运行时对象选择子类实现。\n'

/**
 * 在页面中安装 Tauri IPC：原生命令转发到 Node 端的 DesktopBackend；
 * 事件与 HTTP 插件在页面内实现，AI 请求经由页面 fetch 发出，便于用 page.route 拦截。
 * 该函数会被序列化后注入页面，不能引用外部变量。
 */
function installTauri({ mediaBase }: { mediaBase: string }) {
  type Callback = (data: unknown) => unknown
  const callbacks = new Map<number, Callback>()
  const listeners = new Map<string, number[]>()
  const http = new Map<number, any>()
  let nextId = 1
  const transformCallback = (callback?: Callback, once = false) => {
    const id = nextId++
    callbacks.set(id, data => { if (once) callbacks.delete(id); return callback?.(data) })
    return id
  }
  const runCallback = (id: number, data: unknown) => callbacks.get(id)?.(data)
  const toBuffer = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer

  async function httpCommand(command: string, args: any) {
    switch (command) {
      case 'plugin:http|fetch': {
        const rid = nextId++
        http.set(rid, { config: args.clientConfig, controller: new AbortController() })
        return rid
      }
      case 'plugin:http|fetch_send': {
        const request = http.get(args.rid)
        const { method, url, headers, data } = request.config
        const response = await fetch(url, { method, headers, body: data ? new Uint8Array(data) : undefined, signal: request.controller.signal })
        const rid = nextId++
        http.set(rid, { body: new Uint8Array(await response.arrayBuffer()), sent: false })
        return { status: response.status, statusText: response.statusText, url: response.url, headers: [...response.headers], rid }
      }
      case 'plugin:http|fetch_read_body': {
        const response = http.get(args.rid)
        if (response && !response.sent) { response.sent = true; return [...response.body, 0] }
        http.delete(args.rid)
        return [1]
      }
      case 'plugin:http|fetch_cancel': http.get(args.rid)?.controller?.abort(); return null
      default: http.delete(args.rid); return null
    }
  }

  async function invoke(command: string, args: any = {}) {
    if (command.startsWith('plugin:http|')) return httpCommand(command, args)
    if (command === 'plugin:event|listen') {
      listeners.set(args.event, [...(listeners.get(args.event) ?? []), args.handler])
      return args.handler
    }
    if (command === 'plugin:event|unlisten') {
      listeners.set(args.event, (listeners.get(args.event) ?? []).filter(id => id !== args.eventId))
      return null
    }
    if (command === 'plugin:event|emit') {
      for (const id of listeners.get(args.event) ?? []) runCallback(id, { event: args.event, id, payload: args.payload })
      return null
    }
    // Channel 序列化为 "__CHANNEL__:<id>"，由 Node 端回传消息后在此分发。
    const reply: Reply = await (window as any).__aiPlayerDesktop(command, JSON.parse(JSON.stringify(args ?? {})))
    for (const { channel, messages } of reply.channels ?? []) {
      const id = Number(channel.split(':')[1])
      messages.forEach((message, index) => runCallback(id, { index, message }))
      runCallback(id, { index: messages.length, end: true })
    }
    if (!reply.ok) throw reply.error
    return reply.base64 !== undefined ? toBuffer(reply.base64) : reply.value
  }

  ;(window as any).__TAURI_INTERNALS__ = {
    invoke, transformCallback, runCallback, callbacks,
    unregisterCallback: (id: number) => callbacks.delete(id),
    convertFileSrc: (file: string, protocol = 'asset') => `${mediaBase}/${protocol}/${encodeURIComponent(file)}`,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    plugins: {},
  }
  ;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event: string, id: number) => listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== id)),
  }
}

const test = base.extend<{ desktop: DesktopBackend }>({
  desktop: async ({ context }, use) => {
    const desktop = await DesktopBackend.create()
    desktop.course.paths = paths
    desktop.course.subtitle = subtitle
    await context.exposeBinding('__aiPlayerDesktop', (_source, command: string, args: Record<string, unknown>) => desktop.handle(command, args))
    await context.addInitScript({ content: `(${installTauri.toString()})(${JSON.stringify({ mediaBase: desktop.mediaBase })})` })
    await use(desktop)
    await desktop.close()
  },
  // 页面创建前先完成桌面端环境注入。
  page: async ({ page, desktop }, use) => { void desktop; await use(page) },
})

function plan() {
  return {
    summary: '为 SpringBoot 项目开发保留关键基础，其他基础按需查漏。', profile: '学过 Java，每天两小时，希望上手 SpringBoot。', dailyMinutes: 120,
    modules: [{ id: 'base', title: 'Java 基础与机制', description: '理解框架背后的语言机制' }, { id: 'project', title: 'SpringBoot 项目', description: '从框架到项目实战' }],
    lessons: paths.map((path, i) => ({ path, moduleId: i < 4 ? 'base' : 'project', concepts: [titles[i]!.split('-')[1]],
      prerequisites: i === 4 ? [paths[1], paths[2]] : [], status: i === 4 ? 'required' : i === 5 ? 'optional' : 'skipped', reason: i === 4 ? '直接服务项目开发目标' : '按已有基础与目标选取' })),
  }
}

/** 当前课程 ID（取自 /courses/:id 路由）。 */
function courseId(page: Page) {
  return new URL(page.url()).hash.split('/')[2]!.split('?')[0]!
}

async function openCourse(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '打开课程文件夹', exact: true }).click()
  await page.getByRole('button', { name: /开始学习|继续学习/ }).click()
  await expect(page.getByRole('heading', { name: titles[0], exact: true })).toBeVisible()
}

async function configure(page: Page) {
  await page.getByRole('button', { name: 'AI 导学', exact: true }).click()
  await page.getByRole('button', { name: 'AI 设置', exact: true }).click()
  await page.getByLabel('配置名称', { exact: true }).fill('测试 AI')
  await page.getByLabel('服务地址', { exact: true }).fill('https://guide.test/v1')
  await page.getByLabel('模型名称', { exact: true }).fill('fixture-model')
  await page.getByLabel('API 密钥', { exact: true }).fill('only-for-this-test')
  await page.getByRole('button', { name: '保存并使用', exact: true }).click()
  await page.getByRole('button', { name: '返回定制路线', exact: true }).click()
}

async function generate(page: Page) {
  await page.getByLabel('学习背景与目标', { exact: true }).fill('学过 Java，想速成 SpringBoot 开发项目，每天 2 小时。')
  await page.getByRole('button', { name: '生成学习路线', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'AI 智能导学', exact: true }).getByRole('heading', { name: '学习路线', exact: true })).toBeVisible()
}

export { test, expect, paths, titles, plan, courseId, openCourse, configure, generate }

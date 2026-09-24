/**
 * Node 单元测试使用的 Tauri HTTP 插件桥接：
 * 前端的 platformFetch 调用 @tauri-apps/plugin-http，这里把对应的 IPC 命令转交给当前的 globalThis.fetch，
 * 测试只需替换 globalThis.fetch 即可模拟 AI 服务。请求头名称按 Headers 规范为小写。
 */
const resources = new Map()
let nextId = 1

async function invoke(command, args) {
  switch (command) {
    case 'plugin:http|fetch': {
      const rid = nextId++
      resources.set(rid, { config: args.clientConfig, controller: new AbortController() })
      return rid
    }
    case 'plugin:http|fetch_send': {
      const { config, controller } = resources.get(args.rid)
      const response = await globalThis.fetch(config.url, {
        method: config.method,
        headers: Object.fromEntries(config.headers),
        body: config.data ? new TextDecoder().decode(new Uint8Array(config.data)) : undefined,
        signal: controller.signal,
      })
      const rid = nextId++
      resources.set(rid, { body: new Uint8Array(await response.arrayBuffer()), sent: false })
      return { status: response.status, statusText: response.statusText, url: config.url, headers: [...response.headers], rid }
    }
    case 'plugin:http|fetch_read_body': {
      const response = resources.get(args.rid)
      if (response && !response.sent) { response.sent = true; return [...response.body, 0] }
      resources.delete(args.rid)
      return [1]
    }
    case 'plugin:http|fetch_cancel':
      resources.get(args.rid)?.controller?.abort()
      return null
    case 'plugin:http|fetch_cancel_body':
      resources.delete(args.rid)
      return null
    default:
      throw new Error(`测试环境未实现命令：${command}`)
  }
}

globalThis.window ??= globalThis
globalThis.window.__TAURI_INTERNALS__ = { invoke }

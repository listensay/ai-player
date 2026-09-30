export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function desktopInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  try { return await invoke<T>(command, args) }
  catch (error) { throw error instanceof Error ? error : new Error(String(error)) }
}

/** AI 请求经由 Tauri 原生 HTTP 客户端发送，支持取消与流式读取。 */
export async function platformFetch(input: string, init?: RequestInit): Promise<Response> {
  const { fetch: nativeFetch } = await import('@tauri-apps/plugin-http')
  const headers = new Headers(init?.headers)
  // 原生 API 调用不属于网页跨域请求。插件在启用 unsafe-headers 后会删除空 Origin，
  // 避免自动附加 tauri://localhost 导致兼容服务拒绝 POST；不伪装成服务网站来源。
  headers.set('Origin', '')
  try { return await nativeFetch(input, { ...init, headers }) }
  catch (error) { throw error instanceof Error ? error : new Error(String(error)) }
}

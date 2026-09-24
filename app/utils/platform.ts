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
  try { return await nativeFetch(input, init) }
  catch (error) { throw error instanceof Error ? error : new Error(String(error)) }
}

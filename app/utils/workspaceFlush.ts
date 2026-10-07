let prepare: (() => Promise<void>) | undefined
export function registerWorkspaceFlush(handler: () => Promise<void>) {
  prepare = handler
  return () => {
    if (prepare === handler) prepare = undefined
  }
}
export async function flushWorkspace() {
  if (!prepare) throw Error('工作区正在准备，请稍后重试。')
  await prepare()
}

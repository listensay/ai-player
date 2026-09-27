export interface ReminderLinkRequest { token: string; reminderId: string }
export interface ReminderLinkDestination { courseId: string | null; lesson: string | null; notice: string }

/** Serial delivery handles the startup/event race and leaves failed requests available for retry. */
export function createReminderLinkConsumer(options: {
  pending: () => Promise<ReminderLinkRequest | null>
  open: (request: ReminderLinkRequest) => Promise<void>
  acknowledge: (token: string) => Promise<unknown>
  error: (message: string) => void
}) {
  let queue: Promise<void> = Promise.resolve(), stopped = false, opened = ''
  function wake() {
    queue = queue.then(async () => {
      if (stopped) return
      const request = await options.pending()
      if (!request || stopped) return
      options.error('')
      if (opened !== request.token) {
        await options.open(request)
        opened = request.token
      }
      if (!stopped) await options.acknowledge(request.token)
    }).catch(error => { if (!stopped) options.error(`无法从提醒打开课程：${String(error)}`) })
    return queue
  }
  return { wake, stop: () => { stopped = true } }
}

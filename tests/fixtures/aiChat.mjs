import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

// A loopback service keeps the real desktop HTTP transport and both wire protocols under test.
export async function prepareAiChat(directory) {
  const server = createServer(async (request, response) => {
    try {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      const native = request.url === '/v1/messages'
      const question = body.messages.at(-1).content
      if (question === '慢回复') return
      const history = body.messages.filter((message) => message.role === 'assistant').length
      const text = `${body.model}：${question}；历史 ${history}`
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify(
          native
            ? { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] }
            : { choices: [{ finish_reason: 'stop', message: { content: text } }] },
        ),
      )
    } catch {
      response.writeHead(400).end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const close = () =>
    new Promise((resolve, reject) => {
      server.closeAllConnections()
      server.close((error) => (error ? reject(error) : resolve()))
    })
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
    const db = new DatabaseSync(join(directory, 'ai-player.db'))
    try {
      db.prepare('INSERT OR REPLACE INTO app_settings VALUES (?,?,?)').run(
        'ai_settings',
        JSON.stringify({
          version: 2,
          activeId: '',
          profiles: [
            {
              id: 'chat-openai',
              name: '测试服务',
              provider: 'openai',
              baseUrl,
              apiKey: '',
              model: 'chat-one',
              modelIds: ['chat-one', 'chat-two'],
            },
            {
              id: 'chat-native',
              name: '另一服务',
              provider: 'anthropic',
              baseUrl,
              apiKey: '',
              model: 'chat-native',
              modelIds: ['chat-native'],
            },
          ],
        }),
        Date.now(),
      )
    } finally {
      db.close()
    }
  } catch (error) {
    await close()
    throw error
  }
  return close
}

import { spawn } from 'node:child_process'
await import('./desktop-runtime.mjs')
const dev = process.argv[2] === 'dev'
const args = dev ? ['--host', '127.0.0.1', '--port', '1420'] : ['build']
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...args], {
  stdio: 'inherit', env: process.env,
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => process.exit(code ?? 1))

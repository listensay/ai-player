#!/usr/bin/env node
/**
 * ASR 服务启动器。
 *
 * sherpa-onnx 的原生扩展在 macOS 上需要 DYLD_LIBRARY_PATH 指向平台包目录才能找到 dylib，
 * 在 Linux 上对应 LD_LIBRARY_PATH。这个启动器算好路径后把真正的服务（server.mjs）
 * 作为子进程拉起，用户只需要 `npm run asr`，不用自己 export 环境变量。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const platform = os.platform() === 'win32' ? 'win' : os.platform()
const pkgName = `sherpa-onnx-${platform}-${os.arch()}`

let libDir = ''
try {
  libDir = path.dirname(require.resolve(`${pkgName}/package.json`))
} catch {
  console.error(
    `找不到 ${pkgName}。请先在项目根目录执行 npm install；` +
      `当前平台 ${os.platform()}/${os.arch()} 若没有预编译包，需要参考 sherpa-onnx 文档自行编译。`,
  )
  process.exit(1)
}

const env = { ...process.env }
if (os.platform() === 'darwin') {
  env.DYLD_LIBRARY_PATH = [libDir, env.DYLD_LIBRARY_PATH].filter(Boolean).join(':')
} else if (os.platform() === 'linux') {
  env.LD_LIBRARY_PATH = [libDir, env.LD_LIBRARY_PATH].filter(Boolean).join(':')
} else if (os.platform() === 'win32') {
  env.PATH = [libDir, env.PATH].filter(Boolean).join(';')
}

const serverPath = path.join(here, 'server.mjs')
if (!existsSync(serverPath)) {
  console.error(`缺少 ${serverPath}`)
  process.exit(1)
}

const child = spawn(process.execPath, [serverPath, ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
})

const forward = (signal) => () => {
  if (!child.killed) child.kill(signal)
}
process.on('SIGINT', forward('SIGINT'))
process.on('SIGTERM', forward('SIGTERM'))
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})

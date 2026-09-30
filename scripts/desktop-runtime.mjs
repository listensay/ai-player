import { readFile, access } from 'node:fs/promises'
import { syncRuntime } from './runtime-cache.mjs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'src-tauri/runtime')
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('桌面构建需要官方 Node.js 24 LTS 发行版')
if (
  process.env.TAURI_ENV_TARGET_TRIPLE &&
  !process.env.TAURI_ENV_TARGET_TRIPLE.startsWith(
    process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : 'i686',
  )
)
  throw new Error('请在安装包的目标架构上构建转写运行环境')
if (process.platform === 'darwin') {
  const links = execFileSync('otool', ['-L', process.execPath], { encoding: 'utf8' })
    .split('\n')
    .slice(1)
    .filter(Boolean)
  if (links.some((line) => !/^\s+\/(System|usr\/lib)\//.test(line)))
    throw new Error('Node.js 依赖非系统动态库，请使用 nodejs.org 官方发行版')
}
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
const nodeRoot = path.resolve(process.execPath, process.platform === 'win32' ? '..' : '../..')
const files = [
  { source: process.execPath, destination: nodeName },
  { source: path.join(nodeRoot, 'LICENSE'), destination: 'NODE-LICENSE' },
]
const trees = [{ source: path.join(root, 'asr-server'), destination: 'asr-server' }]
const copied = new Set()
async function copyPackage(name, from = require) {
  let manifest
  try {
    manifest = from.resolve(`${name}/package.json`)
  } catch {
    let dir = path.dirname(from.resolve(name))
    while (dir !== path.dirname(dir)) {
      try {
        const p = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
        if (p.name === name) {
          manifest = path.join(dir, 'package.json')
          break
        }
      } catch {
        /* Keep looking for the owning package manifest. */
      }
      dir = path.dirname(dir)
    }
  }
  if (!manifest) throw new Error(`无法定位运行时依赖 ${name}`)
  const pkg = JSON.parse(await readFile(manifest, 'utf8'))
  if (copied.has(`${name}@${pkg.version}`)) return
  if ([...copied].some((p) => p.startsWith(`${name}@`))) throw new Error(`运行时依赖版本冲突：${name}`)
  copied.add(`${name}@${pkg.version}`)
  trees.push({ source: path.dirname(manifest), destination: path.join('node_modules', name) })
  for (const dependency of Object.keys(pkg.dependencies || {})) await copyPackage(dependency, createRequire(manifest))
}
const platformPackage = `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
for (const name of ['sherpa-onnx-node', platformPackage, 'tar', 'unbzip2-stream']) await copyPackage(name)
const ffmpeg = require('ffmpeg-static')
await access(ffmpeg)
files.push({ source: ffmpeg, destination: process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg' })
for (const name of ['LICENSE', 'README.md', 'ffmpeg.LICENSE', 'ffmpeg.README']) {
  files.push({
    source: path.join(path.dirname(require.resolve('ffmpeg-static/package.json')), name),
    destination: `FFMPEG-${name}`,
  })
}
const counts = await syncRuntime({
  output,
  trees,
  files,
  generated: { 'package.json': JSON.stringify({ private: true, type: 'module' }) },
  identity: {
    version: 1,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    packages: [...copied].sort(),
  },
})
console.log(
  `已准备 ${process.platform}/${process.arch} 内置转写环境：更新 ${counts.copied}，复用 ${counts.reused}，移除过期文件 ${counts.removed}`,
)

import { mkdir, readdir, stat, readFile, writeFile, copyFile, rename, rm, chmod } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const stamp = (info) => `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.mode}`
const digest = (text) => createHash('sha256').update(text).digest('hex')
async function inventory(directory, prefix = '', result = new Map()) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, item.name),
      source = path.join(directory, item.name)
    if ((await stat(source)).isDirectory()) await inventory(source, relative, result)
    else result.set(relative, source)
  }
  return result
}

/** Synchronize only changed inputs; publish the manifest after every file has succeeded. */
export async function syncRuntime({ output, trees = [], files = [], generated = {}, identity }) {
  await mkdir(output, { recursive: true })
  const manifestPath = path.join(output, 'manifest.json')
  let previous
  try {
    previous = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    /* First build or interrupted legacy build. */
  }
  const fingerprint = digest(JSON.stringify(identity))
  const cached = previous?.fingerprint === fingerprint ? (previous.files ?? {}) : {}
  const sources = new Map(files.map((item) => [item.destination, item.source]))
  for (const tree of trees)
    for (const [name, source] of await inventory(tree.source)) sources.set(path.join(tree.destination, name), source)
  const next = {},
    counts = { copied: 0, reused: 0, removed: 0 }
  for (const name of [...sources.keys(), ...Object.keys(generated)]) {
    if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..')) throw Error('无效的运行环境路径')
    const destination = path.join(output, name),
      source = sources.get(name)
    const signature = source ? `${source}:${stamp(await stat(source))}` : digest(generated[name])
    let current
    try {
      current = stamp(await stat(destination))
    } catch {
      /* Missing output must be repaired. */
    }
    if (cached[name]?.source === signature && cached[name]?.target === current) {
      next[name] = cached[name]
      counts.reused++
      continue
    }
    await mkdir(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.runtime-tmp`
    try {
      if (source) {
        await copyFile(source, temporary)
        await chmod(temporary, (await stat(source)).mode)
      } else await writeFile(temporary, generated[name])
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
    next[name] = { source: signature, target: stamp(await stat(destination)) }
    counts.copied++
  }
  for (const name of (await inventory(output)).keys()) {
    if (name === 'manifest.json' || Object.hasOwn(next, name)) continue
    await rm(path.join(output, name), { force: true })
    counts.removed++
  }
  const manifest = { ...identity, fingerprint, files: next }
  if (JSON.stringify(previous) !== JSON.stringify(manifest)) {
    await writeFile(`${manifestPath}.runtime-tmp`, JSON.stringify(manifest, null, 2))
    await rename(`${manifestPath}.runtime-tmp`, manifestPath)
  }
  return counts
}

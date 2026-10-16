import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const upstream = JSON.parse(await readFile(join(root, 'integrations/affine/upstream.json'), 'utf8'))
const source = resolve(process.env.AFFINE_SOURCE_DIR || join(root, '.cache/affine-source'))
const node = process.env.AFFINE_NODE || process.execPath
const output = join(root, 'src-tauri/affine')
const patch = join(root, 'integrations/affine/local.patch')
const environment = {
  ...process.env,
  PATH: `${dirname(node)}:${process.env.PATH}`,
  BUILD_TYPE: 'stable',
  PUBLIC_PATH: '/',
  NODE_OPTIONS: '--max-old-space-size=8192',
}
// Upstream supports publishing assets during a build. This integration only builds locally.
for (const key of ['R2_SECRET_ACCESS_KEY', 'R2_ACCESS_KEY_ID', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT']) {
  delete environment[key]
}
const run = (cmd, args, cwd = source, capture = false) => {
  const result = spawnSync(cmd, args, {
    cwd,
    env: environment,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
  })
  if (result.status !== 0)
    throw new Error(`${cmd} ${args.join(' ')} failed: ${result.stderr || result.error || result.status}`)
  return result.stdout?.trim()
}

if (Number(run(node, ['-p', 'process.versions.node.split(".")[0]'], root, true)) !== upstream.nodeMajor) {
  throw new Error('AFFiNE requires Node 22; set AFFINE_NODE to its executable path.')
}
await mkdir(dirname(source), { recursive: true })
if (!(await stat(join(source, '.git')).catch(() => null))) {
  run('git', ['clone', '--depth', '1', '--branch', upstream.tag, '--single-branch', upstream.repository, source], root)
}
if (run('git', ['rev-parse', 'HEAD'], source, true) !== upstream.commit)
  throw new Error('Unexpected AFFiNE source revision')
const alreadyApplied =
  spawnSync('git', ['apply', '--reverse', '--check', patch], { cwd: source, stdio: 'ignore' }).status === 0
if (!alreadyApplied) run('git', ['apply', patch])
if (!(await stat(join(source, 'node_modules/.yarn-state.yml')).catch(() => null))) {
  run(node, [upstream.yarn, 'install', '--immutable'])
}
run(node, [upstream.yarn, 'affine', 'bundle', '-p', '@affine/web'])
const staging = `${output}.building`
await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })
await cp(join(source, 'packages/frontend/apps/web/dist'), staging, {
  recursive: true,
  filter: (path) => !path.endsWith('.map'),
})
await mkdir(join(staging, 'licenses'), { recursive: true })
for (const [from, to] of [
  ['LICENSE', 'AFFiNE-LICENSE.txt'],
  ['LICENSE-MIT', 'AFFiNE-MIT.txt'],
  ['packages/backend/server/LICENSE', 'AFFiNE-CE-EE-LICENSE.txt'],
]) {
  await cp(join(source, from), join(staging, 'licenses', to))
}
await cp(patch, join(staging, 'licenses/ai-player-modifications.patch'))
const assets = {}
async function inventory(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`
    if (entry.isDirectory()) await inventory(join(directory, entry.name), `${name}/`)
    else
      assets[name] = createHash('sha256')
        .update(await readFile(join(directory, entry.name)))
        .digest('hex')
  }
}
await inventory(staging)
await writeFile(join(staging, 'build-manifest.json'), JSON.stringify({ ...upstream, assets }, null, 2) + '\n')
await rm(output, { recursive: true, force: true })
await cp(staging, output, { recursive: true })
await rm(staging, { recursive: true, force: true })
console.log(`AFFiNE local workspace built: ${output}`)

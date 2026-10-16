import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const source = resolve(process.env.AFFINE_SOURCE_DIR || resolve(root, '.cache/affine-source'))
const result = spawnSync(
  process.env.AFFINE_NODE || process.execPath,
  ['--import', 'tsx', '--test', 'packages/frontend/core/src/blocksuite/ai/runtime/request/ai-player-local.test.ts'],
  { cwd: source, stdio: 'inherit' },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1

import { readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..'),
  dist = join(root, 'dist')
const manifest = JSON.parse(await readFile(join(dist, '.vite/manifest.json'), 'utf8'))
function closure(key, seen = new Set()) {
  if (seen.has(key)) return seen
  if (!manifest[key]) throw Error(`Missing build entry: ${key}`)
  seen.add(key)
  for (const imported of manifest[key].imports ?? []) closure(imported, seen)
  return seen
}
const entry = Object.keys(manifest).find((key) => manifest[key].src === 'app/utils/codeEditor.ts')
if (!entry) throw Error('Missing code editor build entry')
const chunks = [...closure(entry)].map((key) => manifest[key].file)
const bytes = (await Promise.all(chunks.map(async (file) => (await stat(join(dist, file))).size))).reduce(
  (a, b) => a + b,
  0,
)
if (bytes > 4_200_000) throw Error(`Code editor eager dependencies: ${bytes} bytes exceeds 4.2 MB`)
if (chunks.some((file) => /tsMode|ts\.worker|typescript/i.test(file)))
  throw Error('TypeScript services entered the eager editor dependency graph')
const main = [...closure('index.html')].map((key) => manifest[key].file)
if (main.some((file) => /NoteEditor|editor\.api|tsMode/.test(file)))
  throw Error('Heavy editors entered the startup dependency graph')
// The ordinary release build must never contain the native-test model access bridge.
const scripts = await Promise.all(
  Object.values(manifest)
    .filter((item) => item.file.endsWith('.js'))
    .map((item) => readFile(join(dist, item.file), 'utf8')),
)
if (scripts.some((source) => source.includes('__AI_PLAYER_SMOKE_EDITOR__')))
  throw Error('Desktop test bridge leaked into the release frontend')
await mkdir(join(root, '.cache'), { recursive: true })
const report = { editorEagerBytes: bytes, editorChunks: chunks, startupChunks: main, typeScriptServices: 'on demand' }
await writeFile(join(root, '.cache/bundle-report.json'), JSON.stringify(report, null, 2))
console.log(
  `Bundle checks passed. Editor eager dependencies: ${(bytes / 1e6).toFixed(2)} MB; TypeScript services load on demand.`,
)

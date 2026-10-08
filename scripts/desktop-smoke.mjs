import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { prepareDesktopSmoke } from './prepare-desktop-smoke.mjs'

const root = resolve(import.meta.dirname, '..')
async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options })
  const timeout = setTimeout(() => child.kill('SIGKILL'), options.timeout ?? 600000)
  try {
    await new Promise((accept, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) =>
        code === 0 ? accept() : reject(Error(`${command} exited: ${code ?? signal}`)),
      )
    })
  } finally {
    clearTimeout(timeout)
  }
}
await run(process.execPath, [
  'node_modules/@tauri-apps/cli/tauri.js',
  'build',
  '--debug',
  '--no-bundle',
  '--features',
  'desktop-smoke',
  '--config',
  'tests/fixtures/desktop-smoke.json',
])
const metadata = JSON.parse(
  execFileSync('cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--no-deps', '--format-version', '1'], {
    encoding: 'utf8',
    cwd: root,
  }),
)
const executable = join(
  metadata.target_directory,
  'debug',
  process.platform === 'win32' ? 'ai-player.exe' : 'ai-player',
)
const data = await mkdtemp(join(tmpdir(), 'ai-player-desktop-smoke-'))
await prepareDesktopSmoke(data)
const reports = []
const fixtureHtml = await readFile(join(root, 'tests/fixtures/notion.html'))
const fixtureServer = createServer((_request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': 'no-store',
  })
  response.end(fixtureHtml)
})
await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve))
const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}`
try {
  for (const phase of ['first', 'second']) {
    try {
      await run(executable, [], {
        env: {
          ...process.env,
          AI_PLAYER_SMOKE_DATA: data,
          AI_PLAYER_SMOKE_PHASE: phase,
          AI_PLAYER_NOTION_SMOKE_URL: fixtureUrl,
        },
        timeout: 180000,
      })
    } finally {
      const report = JSON.parse(
        await readFile(join(data, `${phase}.json`), 'utf8').catch(() =>
          JSON.stringify({ success: false, error: 'Native process did not produce a report' }),
        ),
      )
      reports.push({ phase, ...report })
      if (!report.success) console.error(report)
    }
    if (!reports.at(-1).success) throw Error(`Native desktop regression failed: ${phase}`)
  }
  const limits = {
    'webview-ready': 15000,
    'home-load': 8000,
    'course-open': 10000,
    'video-ready': 10000,
    'programming-ready': 15000,
  }
  for (const report of reports) {
    if (!report.success) throw Error(`Native desktop regression failed: ${report.phase}`)
    for (const name of Object.keys(limits)) {
      if (!report.metrics?.some((metric) => metric.name === `ai-player:${name}`))
        throw Error(`Missing native performance metric: ${name}`)
    }
    for (const metric of report.metrics ?? []) {
      const name = metric.name.replace('ai-player:', '')
      if (!Number.isFinite(metric.duration) || metric.duration < 0 || metric.duration > limits[name])
        throw Error(`${name}: ${metric.duration.toFixed(0)} ms exceeds ${limits[name]} ms`)
    }
  }
  console.log(
    'Native desktop regression passed: Notion view switching/restart, programming execution/cancel, timer pause, backup restore.',
  )
} finally {
  fixtureServer.close()
  await mkdir(join(root, '.cache'), { recursive: true })
  await writeFile(
    join(root, '.cache/desktop-smoke-report.json'),
    JSON.stringify({ dataDirectory: data, reports }, null, 2),
  )
  console.log(`Regression data and reports: ${data}`)
}

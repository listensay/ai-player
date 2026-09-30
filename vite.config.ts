import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const packageInfo = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
let commit = 'unknown',
  dirty = false
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  dirty = !!execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
} catch {
  /* Source archives may not include Git metadata. */
}

export default defineConfig({
  define: {
    __APP_BUILD__: JSON.stringify({ version: packageInfo.version, commit, dirty, builtAt: new Date().toISOString() }),
  },
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) } },
  clearScreen: false,
  server: { strictPort: true },
  build: { target: 'es2022' },
})

import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) } },
  clearScreen: false,
  server: { strictPort: true },
  build: { target: 'es2022' },
})

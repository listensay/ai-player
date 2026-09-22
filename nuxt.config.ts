import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // 本地文件系统、<video>、ProseMirror 都只在浏览器里有意义，整站按纯客户端应用构建
  ssr: false,

  css: [
    // 自托管的 Plus Jakarta Sans（DESIGN.md 中 Headspace Apercu 的替代字体），离线可用
    '@fontsource-variable/plus-jakarta-sans',
    '~/styles/main.css',
  ],

  vite: {
    plugins: [tailwindcss()],
  },

  app: {
    head: {
      title: 'AI Player',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'light' },
        { name: 'theme-color', content: '#f9f4f2' },
      ],
    },
  },
})

export default defineNuxtConfig({
  ssr: false,
  srcDir: 'app/',
  compatibilityDate: '2026-01-01',
  // same-origin in dev: forward /api to the Hono node server
  nitro: { devProxy: { '/api': { target: 'http://localhost:8787/api', changeOrigin: true } } },
})

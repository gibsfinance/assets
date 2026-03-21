import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname,
      $public: new URL('./public', import.meta.url).pathname,
      $images: new URL('./src/images', import.meta.url).pathname,
    },
  },
})

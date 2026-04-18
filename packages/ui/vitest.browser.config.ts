/**
 * Vitest browser-mode config.
 *
 * Runs `*.browser.test.{ts,tsx}` files in a real Chromium engine via the
 * Playwright provider. Separate from the default jsdom run so fast local
 * feedback (`yarn test`) never has to boot a browser.
 *
 * To run locally:
 *   yarn test:browser
 *
 * Requires Playwright's browser binaries — install once with:
 *   yarn playwright install chromium
 */
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  optimizeDeps: {
    include: ['react/jsx-dev-runtime'],
  },
  test: {
    include: ['src/**/*.browser.test.{ts,tsx}'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname,
      $public: new URL('./public', import.meta.url).pathname,
      $images: new URL('./src/images', import.meta.url).pathname,
    },
  },
})

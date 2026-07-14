import { defineConfig, devices } from '@playwright/test'

// Dedicated, uncommon port (override with E2E_PORT). The default vite ports
// (5173/5174) are frequently occupied by other projects' dev servers; combined
// with reuseExistingServer that would silently run the suite against the wrong
// application. A unique port plus reuseExistingServer:false and --strictPort
// guarantees the suite either launches this repo's own UI or fails loudly
// rather than testing whatever else happens to be on the port.
const E2E_PORT = Number(process.env.E2E_PORT) || 5199

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  snapshotPathTemplate: '{testDir}/snapshots/{testName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: process.env.BASE_URL || `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.CI
    ? undefined
    : {
        command: `PUBLIC_BASE_URL=https://staging.gib.show npx vite --port ${E2E_PORT} --strictPort`,
        port: E2E_PORT,
        reuseExistingServer: false,
      },
})

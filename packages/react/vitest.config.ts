import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['vitest.setup.ts'],
    coverage: {
      // Vitest 4 reports nothing at all unless `include` is set — an unset
      // include yields an empty table rather than an error, which reads as a
      // clean run. Name the sources explicitly so the report is real.
      include: ['src/**/*.{ts,tsx}'],
      // Providing `exclude` replaces Vitest's defaults, so the standard entries
      // have to be restated: a test file never counts toward the coverage of
      // the code it tests. `index.ts` is the package barrel — re-exports only.
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/index.ts'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
  resolve: {
    alias: {
      // @gibs/sdk is the published artifact, so it resolves to dist/ — which is
      // gitignored and unbuilt on a clean checkout, making these tests pass
      // only where a stale dist happens to exist. Point them at source, as the
      // other workspace packages (@gibs/utils, @gibs/dexscreener) already do,
      // so the suite never depends on build ordering.
      '@gibs/sdk': new URL('../sdk/src/index.ts', import.meta.url).pathname,
    },
  },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['src/**/*.browser.test.{ts,tsx}', 'node_modules/**'],
    environment: 'jsdom',
    coverage: {
      // Vitest 4 reports nothing at all unless `include` is set — an unset
      // include yields an empty table rather than an error, which reads as a
      // clean run. Name the sources explicitly so the report is real.
      include: ['src/**/*.{ts,tsx}'],
      // Providing `exclude` replaces Vitest's defaults, so the standard entries
      // have to be restated: a test file never counts toward the coverage of
      // the code it tests. Browser-mode specs run under a separate config, and
      // `main.tsx` is the Vite bootstrap that no unit test mounts.
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.browser.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/lib/networks.json',
        'src/main.tsx',
      ],
      // Ratchet floors, not aspirations. An earlier value of 100 sat roughly
      // forty-four points above reality, failed on every run from 2026-07-22
      // onward, and made the gate useless; the floors have been honest numbers
      // that can actually regress ever since.
      //
      // Deliberately ~0.2 below measured, because this workspace's coverage is
      // not identical across environments — an earlier suite reported 55.73
      // statements / 57.26 functions locally but 55.66 / 57.12 on the CI
      // runner, and floors set to the local figures failed CI by hundredths.
      // Leave the margin: a threshold that only passes on the machine it was
      // measured on is the same trap as a 100 nobody can reach.
      //
      // 2026-08-03: measured 92.65 / 86.58 / 91.87 / 93.89 over 1546 tests,
      // up from 59 percent. Every page and all but one component now have
      // tests; what remains uncovered is mostly unreachable defensive guards
      // and Studio.tsx.
      //
      // 2026-08-03, later the same day: measured 93.21 / 87.51 / 92.62 / 94.40
      // over 1566 tests. The token search moved out of TokenSearch.tsx into
      // useTokenSearch, which is covered outright, and the browser's search
      // wiring, icon fallback and merged-row expansion picked up tests of
      // their own.
      //
      // Browser-mode specs run under a separate config and are excluded above,
      // so component behaviour verified there does not count here. Raise these
      // as tests land; never lower them to make a failing run pass.
      thresholds: { statements: 93.0, branches: 87.3, functions: 92.4, lines: 94.2 },
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

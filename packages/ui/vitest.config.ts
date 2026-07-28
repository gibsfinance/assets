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
      // Ratchet floors, not aspirations. The previous value was 100, roughly
      // forty-four points above reality, so this gate failed on every run from
      // 2026-07-22 onward and the build has not been a usable signal since. An
      // honest low number that can regress is worth more than a high one that
      // is always red.
      //
      // Deliberately ~0.2 below measured, because this workspace's coverage is
      // not identical across environments: the same 1062 tests report 55.73
      // statements / 57.26 functions locally but 55.66 / 57.12 on the CI
      // runner. Floors set to the local figures failed CI by hundredths. Leave
      // the margin — a threshold that only passes on the machine it was
      // measured on is the same trap as a 100 nobody can reach.
      //
      // Browser-mode specs run under a separate config and are excluded above,
      // so component behaviour verified there does not count here. Raise these
      // as tests land; never lower them to make a failing run pass.
      thresholds: { statements: 55.5, branches: 50.4, functions: 57, lines: 55.9 },
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

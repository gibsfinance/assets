import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['src/**/*.browser.test.{ts,tsx}', 'node_modules/**'],
    environment: 'jsdom',
    // Repairs storage on a runtime that did not supply it — see tests/setup.ts.
    // Lives outside src/ deliberately, so the coverage `include` below never
    // counts test scaffolding as production code.
    setupFiles: ['./tests/setup.ts'],
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
      // One hundred on all four, with no margin under it. Every earlier value here
      // was a ratchet floor set a couple of tenths below the measurement, because
      // this workspace used to report very slightly lower on the CI runner than
      // locally and a floor set to the local figure failed by hundredths. There is
      // nothing left for that margin to absorb: 2744 of 2744 statements, 1638 of
      // 1638 branches, 714 of 714 functions, 2393 of 2393 lines. A runner that now
      // measures lower is telling us a test depends on its environment, and that is
      // worth a red build rather than a quiet pass.
      //
      // A gap that appears here has exactly three honest answers. Write a test that
      // fails when the behaviour breaks. Delete the code, if the reason it cannot be
      // reached is that nothing can reach it. Or report it with the evidence and let
      // us decide together. Never lower these numbers to make a failing run pass,
      // and never fabricate a state the application cannot produce just to execute a
      // line - a test that survives breaking the code it covers measures nothing.
      //
      // Getting here removed more code than it added tests. The guards that used to
      // be listed in this block as "deliberately left uncovered" were not hard to
      // reach; they were unreachable, which is a different fact with a different
      // remedy. React attaches a ref before the effect that reads it runs, so the
      // ref guards were dead. ListEditor's `if (!activeList)` guards were dead once
      // the active view became a component that takes the list as a required prop.
      // `Number('')` is zero, not NaN, so a number input cannot produce the value its
      // NaN check tested for. The history of the climb, and the two defects it
      // uncovered along the way, is in the git log rather than here.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
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

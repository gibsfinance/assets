import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      // Vitest 4 reports nothing at all unless `include` is set — an unset
      // include yields an empty table rather than an error, which reads as a
      // clean run. Name the sources explicitly so the report is real.
      include: ['src/**/*.ts'],
      // Providing `exclude` replaces Vitest's defaults, so the standard entries
      // have to be restated: a test file never counts toward the coverage of
      // the code it tests. `bin/` holds executable entry points driven through
      // the shell rather than imported, `db/schema*` is table declarations, and
      // `__testing__/` holds shared test harnesses — infrastructure the tests
      // run on, not product code they cover.
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/**/__testing__/**',
        'src/bin/**',
        'src/db/schema.ts',
        'src/db/schema-types.ts',
      ],
      // Ratchet floors, not aspirations. These sit just under what the suite
      // actually covers today (99.77/99.39/99.72/99.85) so any regression
      // trips the gate, while a point of noise does not.
      //
      // They are not 100 because the last few statements are unreachable from
      // unit tests by construction, not by neglect: markListTokensCollected
      // and getLargestLists are live production code whose callers mock the
      // database module, so the Drizzle query builders themselves never
      // execute here. Only integration coverage would reach them, and the
      // integration job does not feed this report. A 100 written here instead
      // of these numbers is what left the build red on every run from
      // 2026-07-22 onward — a gate nobody can pass is a gate everyone learns
      // to ignore. Raise these when real coverage rises; never lower them to
      // make a failing run pass.
      thresholds: { statements: 99.7, branches: 99.3, functions: 99.7, lines: 99.8 },
    },
  },
})

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
      // actually covers today (100/99.95/100/100) so any regression trips the
      // gate, while a point of noise does not. A 100 written here in place of
      // real numbers is what left the build red on every run from 2026-07-22
      // onward — a gate nobody can pass is a gate everyone learns to ignore.
      //
      // 2026-09-08: statements, functions and lines reached 100. The note that
      // used to stand here said markListTokensCollected and getLargestLists were
      // unreachable from unit tests "by construction", because their callers mock
      // the database module. That was wrong, and worth recording as wrong: those
      // two live in db/index.ts, whose own tests mock the Drizzle handle rather
      // than the module, so __testing__/drizzle-harness reaches the query builders
      // directly. Both now have tests. The lesson generalizes — "unreachable" was
      // a claim about the harness nobody had rechecked since the harness changed.
      //
      // One branch stays uncovered on purpose: db/index.ts:1168, the `originalUri`
      // guard on the image-reuse path. Reaching it needs a fresh link row stored
      // under an empty uri, and no collector can write one — every caller derives
      // originalUri from the same uri that found the row. Fabricating that row to
      // flip the branch would test a state the system cannot produce.
      //
      // Raise these as coverage rises; never lower them to make a failing run pass.
      thresholds: { statements: 99.9, branches: 99.9, functions: 99.9, lines: 99.9 },
    },
  },
})

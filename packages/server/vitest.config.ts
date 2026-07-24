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
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
})

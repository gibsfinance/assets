import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
    coverage: {
      // The command-line entry points only wire the tested modules to real paths, the same
      // way packages/server/src/bin does, so the build itself is what exercises them.
      include: ['scripts/**/*.ts'],
      exclude: [
        'scripts/**/*.test.ts',
        'scripts/generate-guides.ts',
        'scripts/generate-openapi.ts',
        'scripts/copy-storybook.ts',
      ],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
})

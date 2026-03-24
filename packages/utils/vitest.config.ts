import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      exclude: ['src/types.ts', 'src/index.ts'],
    },
  },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})

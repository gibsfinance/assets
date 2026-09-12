import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

export default defineConfig([
  // Generated output is rewritten wholesale on the next run, so nothing in it
  // is worth a finding. `coverage` was missing here, and a stale report in it
  // carried an eslint-disable comment that reported itself as unused.
  { ignores: ['dist/**', 'coverage/**'] },
  // The extensions have to include tsx, or the recommended rules and the
  // browser globals skip every component in the package - which is most of it.
  { files: ['**/*.{js,mjs,cjs,ts,tsx}'], plugins: { js }, extends: ['js/recommended'] },
  { files: ['**/*.{js,mjs,cjs,ts,tsx}'], languageOptions: { globals: globals.browser } },
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
])

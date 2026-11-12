import globals from 'globals'
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Build output and generated files have no reader to lint for; the pages are content, not code.
  { ignores: ['dist', 'generated', '.astro', 'coverage', 'node_modules', 'src/content/docs'] },
  { languageOptions: { globals: globals.node } },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
)

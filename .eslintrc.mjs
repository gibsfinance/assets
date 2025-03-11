import globals from 'globals'
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import mocha from 'eslint-plugin-mocha'

export default tseslint.config(
  { languageOptions: { globals: globals.node } },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  mocha.configs.flat.recommended,
  {
    ignores: [
      'images',
      '.DS_Store',
      'node_modules',
      'build',
      'package',
      '.env*',
      '!.env.example',
      'pnpm-lock.yaml',
      'frontend/pnpm-lock.yaml',
      '.eslintrc.mjs',
    ],
    rules: {
      'no-plusplus': 'off',
      'no-await-in-loop': 'off',
      'no-shadow': 'off',
      'prefer-destructuring': 'off',
      'no-use-before-define': 'off',
      'no-restricted-syntax': 'off',
      'node/no-unpublished-require': 'off',
      'func-names': 'off',
      'import/no-dynamic-require': 'off',
      'global-require': 'off',
      'no-loop-func': 'off',
      'no-console': 'off',
      'node/no-missing-require': 'off',
      'import/no-unresolved': 'off',
      'mocha/no-mocha-arrows': 'off',
      'mocha/no-global-tests': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
    },
  },
)

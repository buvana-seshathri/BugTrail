import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      // The analysis core must stay free of browser and extension APIs.
      'no-restricted-globals': ['error', 'chrome', 'window', 'document'],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs', '*.config.{js,ts}'],
    // e2e scripts also run code inside extension pages via page.evaluate.
    languageOptions: { globals: { ...globals.node, chrome: 'readonly' } },
  },
);

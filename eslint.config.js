// Shared ESLint config (flat). Each package extends this.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      globals: {
        // Browser + worker basics; per-package configs can add more
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        ReadableStream: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        crypto: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Turn off both redeclare rules: TypeScript itself catches true redeclarations,
      // and the Zod pattern `const Foo = z.object(…); type Foo = z.infer<typeof Foo>`
      // is a VariableDeclaration + TSTypeAliasDeclaration merge that neither rule
      // handles without false positives.
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-undef': 'off', // TypeScript handles this better
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/.turbo/**',
      '**/.wrangler/**',
      '**/coverage/**',
      'node_modules/**',
      'docs/**',
    ],
  },
];

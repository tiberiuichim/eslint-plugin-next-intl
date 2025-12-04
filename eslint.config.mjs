import eslintPlugin from 'eslint-plugin-eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ["dist/", "artifacts/", "coverage/", "debug-*.mjs"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    },
  },
  {
    files: ["src/**/*.ts"],
    plugins: {
      "eslint-plugin": eslintPlugin,
    },
    rules: {
      ...eslintPlugin.configs.recommended.rules,
      'eslint-plugin/require-meta-docs-description': 'error',
    },
  },
];

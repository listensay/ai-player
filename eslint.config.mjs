import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import prettier from 'eslint-config-prettier'

export default defineConfig([
  globalIgnores([
    '.cache/**',
    'dist/**',
    'node_modules/**',
    'src-tauri/runtime/**',
    'src-tauri/target/**',
    'src-tauri/gen/**',
  ]),
  {
    files: ['**/*.{js,mjs,ts,vue}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    extends: [js.configs.recommended],
  },
  { files: ['**/*.{ts,vue}'], extends: [ts.configs.recommended] },
  vue.configs['flat/essential'],
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: ts.parser } } },
  {
    files: ['**/*.{ts,vue}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      'vue/no-mutating-props': ['error', { shallowOnly: true }],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  },
  prettier,
])

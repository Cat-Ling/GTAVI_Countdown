import globals from 'globals';
import js from '@eslint/js';
import compatPlugin from 'eslint-plugin-compat';

export default [
  js.configs.recommended,
  compatPlugin.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      }
    },
    rules: {
      'no-unused-vars': 'warn',
    }
  }
];

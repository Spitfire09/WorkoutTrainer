import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        confirm: 'readonly',
        alert: 'readonly',
        crypto: 'readonly',
        history: 'readonly',
        location: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        caches: 'readonly',
        console: 'readonly',
        self: 'readonly',
        Promise: 'readonly',
        Date: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_|^e$' }],
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];

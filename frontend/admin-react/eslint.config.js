import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        localStorage: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        CustomEvent: 'readonly',
        SVGElement: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        performance: 'readonly',
        crypto: 'readonly',
        Worker: 'readonly',
        globalThis: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        alert: 'readonly',
        Image: 'readonly',
        XMLSerializer: 'readonly',
        DOMParser: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        PointerEvent: 'readonly',
        WheelEvent: 'readonly',
        TouchEvent: 'readonly',
        DragEvent: 'readonly',
        InputEvent: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        Range: 'readonly',
      },
    },
    settings: {
      react: { version: '18.3' },
    },
    rules: {
      // React
      ...reactPlugin.configs['jsx-runtime'].rules,
      'react/prop-types': 'off',
      'react/display-name': 'off',
      'react/no-unknown-property': 'off', // SVG attributes like stroke-width
      // Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // General
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'error',
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
    },
  },
  prettierConfig,
  {
    ignores: ['dist/', 'node_modules/'],
  },
];

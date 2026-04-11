import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    exclude: ['**/*.integration.test.js', '**/node_modules/**', '**/dist/**', 'infra/**'],
    globals: true,
    include: ['client/**/*.test.{js,jsx}', 'server/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
  },
});

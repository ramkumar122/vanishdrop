import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['server/test/infra.integration.test.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

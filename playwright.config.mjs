import { defineConfig } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    acceptDownloads: true,
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
  },
  webServer: {
    command: 'VITE_API_URL= npm run build --workspace=client && node test/e2e/server.mjs',
    port,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
const basePath = process.env.VITE_BASE_PATH || '/';
const baseURL = `http://127.0.0.1:5174${basePath}`;
export default defineConfig({
  testDir: 'tests',
  timeout: 90000,
  workers: 1,
  outputDir: path.join(os.tmpdir(), 'porfground-tests'),
  use: { baseURL, viewport: { width: 1536, height: 1024 } },
  webServer: {
    command: `npm run ${process.env.PLAYWRIGHT_PRODUCTION ? 'preview' : 'dev'} -- --port 5174 --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});

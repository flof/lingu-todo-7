import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../..', import.meta.url));
const port = 8099;

/**
 * The tests run against the real production build — the same files nginx will
 * serve — so a broken build fails here rather than on the VPS.
 */
export default defineConfig({
  testDir: here,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 5'] } }],
  webServer: {
    command: `node ${root}/scripts/seed-e2e.mjs && npm --prefix ${root} run build && node ${root}/server/src/index.ts`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: String(port),
      DATA_DIR: `${root}/.e2e`,
      STATIC_DIR: `${root}/client/dist`,
      SECURE_COOKIES: 'false',
      APP_URL: `http://127.0.0.1:${port}`,
    },
  },
});

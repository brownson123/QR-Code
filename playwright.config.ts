import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Fixtures in e2e tests talk to the local Supabase stack, like the int tests.
if (existsSync('.env.test')) process.loadEnvFile('.env.test');

const port = 3100;
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: origin, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --port ${port}`,
    url: origin,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_APP_ORIGIN: origin },
  },
});

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
  globalSetup: './tests/e2e/global-setup.ts',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /audit\// },
    // T-SEC-05 / T-PRIV-03: runs after every other e2e test and inspects what they left behind.
    { name: 'audit', testMatch: /audit\/.*\.spec\.ts/, dependencies: ['chromium'] },
  ],
  webServer: {
    // Server output is kept for T-SEC-05. Never reuse a running server: its log isn't ours.
    command: `mkdir -p .e2e && pnpm dev --port ${port} 2>&1 | tee .e2e/server.log`,
    url: origin,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_PUBLIC_APP_ORIGIN: origin },
  },
});

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const envTestPath = fileURLToPath(new URL('./.env.test', import.meta.url));
const testEnv = existsSync(envTestPath) ? parseEnv(readFileSync(envTestPath, 'utf8')) : {};

const alias = {
  '@': root,
  // `server-only` throws outside the react-server condition; tests run server code directly.
  'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node', allowOnly: false },
      },
      {
        resolve: { alias },
        test: {
          name: 'int',
          allowOnly: false,
          fileParallelism: false,
          include: ['tests/int/**/*.test.ts'],
          environment: 'node',
          env: testEnv,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'lib/db/types.gen.ts',
    'playwright-report/**',
    'test-results/**',
    'apps-script/**',
  ]),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
    },
    // CLAUDE.md: no eslint-disable comments anywhere.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
  },
]);

import { describe, expect, it } from 'vitest';
import { parseServerEnv } from '@/lib/env';

const valid = {
  NEXT_PUBLIC_APP_ORIGIN: 'http://localhost:3000',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SHEET_INGEST_SECRET: 'x'.repeat(32),
  DRAIN_SECRET: 'y'.repeat(32),
  EMAIL_PROVIDER: 'console',
};

describe('lib/env (S0 smoke)', () => {
  it('accepts a complete console-mode env', () => {
    expect(parseServerEnv(valid).EMAIL_PROVIDER).toBe('console');
  });

  it('throws listing a missing required key, without echoing secret values', () => {
    const rest: Record<string, string> = { ...valid };
    delete rest.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => parseServerEnv({ ...rest, DRAIN_SECRET: 'short-secret-value' })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY[\s\S]*DRAIN_SECRET/,
    );
    try {
      parseServerEnv({ ...rest, DRAIN_SECRET: 'short-secret-value' });
    } catch (e) {
      expect(String(e)).not.toContain('short-secret-value');
    }
  });

  it('treats empty strings as unset', () => {
    expect(() => parseServerEnv({ ...valid, DRAIN_SECRET: '' })).toThrow(/DRAIN_SECRET/);
  });

  it('requires RESEND_API_KEY and EMAIL_FROM when EMAIL_PROVIDER=resend', () => {
    expect(() => parseServerEnv({ ...valid, EMAIL_PROVIDER: 'resend' })).toThrow(/RESEND_API_KEY[\s\S]*EMAIL_FROM/);
  });

  it('rejects an app origin with a path or trailing slash', () => {
    expect(() => parseServerEnv({ ...valid, NEXT_PUBLIC_APP_ORIGIN: 'http://localhost:3000/' })).toThrow(/APP_ORIGIN/);
  });
});

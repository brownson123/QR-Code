import pg from 'pg';

// Local Supabase only (CLAUDE.md: never a remote project).
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.test)');
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('TEST_DATABASE_URL must point at the local Supabase stack');
  }
  return url;
}

export function createPool(max: number): pg.Pool {
  return new pg.Pool({ connectionString: testDatabaseUrl(), max });
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.test)`);
  return value;
}

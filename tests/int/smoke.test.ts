import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl } from '../fixtures/db';

describe('local Postgres (S0 smoke)', () => {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 2 });
  afterAll(() => pool.end());

  it('answers select 1', async () => {
    const { rows } = await pool.query<{ one: number }>('select 1 as one');
    expect(rows[0]?.one).toBe(1);
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import { SCAN_CODES } from '@/lib/domain/scan-codes';
import { createPool } from '../fixtures/db';

const pool = createPool(1);
afterAll(() => pool.end());

describe('scan codes (I-15)', () => {
  it('T-SCAN-23: the codes record_scan() can return equal the ScanCode union', async () => {
    const { rows } = await pool.query<{ src: string }>(
      `select pg_get_functiondef('public.record_scan(uuid,uuid,scan_method,text,uuid,uuid,timestamptz)'::regprocedure) as src`,
    );
    const src = rows[0]?.src ?? '';
    const sqlCodes = new Set([...src.matchAll(/'code'\s*,\s*'([A-Z_]+)'/g)].map((m) => m[1]));
    expect([...sqlCodes].sort()).toEqual([...SCAN_CODES].sort());
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ingestClient, sheetRow } from '../fixtures/ingest';
import { onlyEmailTo, tokenFromEmail } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

describe('token secrecy (I-3)', () => {
  it('T-TOK-07: after ingest → email → scan, the raw token appears in no text/json column of any public table', async () => {
    const c = ingestClient();
    const row = sheetRow(f.slug);
    expect(await c.ingest(f.slug, [row])).toEqual(['PASS_QUEUED']);
    await c.drain(); // drains every due row, so pick out the email addressed to this participant
    const token = tokenFromEmail(onlyEmailTo(c.mail.sent, row.email));
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token })).code).toBe('ACCEPTED');

    const { rows: cols } = await f.pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY', 'USER-DEFINED')`,
    );
    expect(cols.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const c of cols) {
      const { rows } = await f.pool.query<{ n: number }>(
        `select count(*)::int as n from public.${JSON.stringify(c.table_name)} where ${JSON.stringify(c.column_name)}::text like '%' || $1 || '%'`,
        [token],
      );
      if ((rows[0]?.n ?? 0) > 0) hits.push(`${c.table_name}.${c.column_name}`);
    }
    expect(hits).toEqual([]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient } from '../fixtures/admin-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let org: string;
let vol: string;
const c = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  [org, vol] = await Promise.all([signInAs(f.staffEmail.org1), signInAs(f.staffEmail.vol1)]);
  await f.pool.query(`update participants set first_name = '=HYPERLINK("http://x")' where id = $1`, [f.p.N]);
  await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A });
  const r = await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.A });
  await f.voidScan(r.scanId ?? '', f.staff.org1, 'Wrong checkpoint');
});
afterAll(async () => {
  await f.close();
});

const lines = (csv: unknown) => String(csv).replace(/^﻿/, '').split('\r\n').filter(Boolean);

describe('CSV export (SPEC §11, §13)', () => {
  it('T-ANA-04 (route): participants.csv is a BOM-prefixed CSV with formula-guarded names', async () => {
    const res = await c.call('exportCsv', org, { slug: f.slug, kind: 'participants.csv' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${f.slug}-participants.csv"`);
    expect(String(res.body).startsWith('﻿')).toBe(true);
    const rows = lines(res.body);
    expect(rows[0]).toBe('"first_name","last_name","email","status","source","is_test","dietary_notes","checked_in_at_local","has_photo","applicant_id"');
    expect(rows.some((r) => r.startsWith(`"'=HYPERLINK(""http://x"")"`))).toBe(true);
    expect(rows.find((r) => r.startsWith('"Ada"'))).toMatch(/"accepted","seed","false","Vegetarian","\w{3}, \w{3} \d+ · /);
  });

  it('§11: scans.csv is live-only by default; includeVoided adds voided rows with their reason', async () => {
    const live = lines((await c.call('exportCsv', org, { slug: f.slug, kind: 'scans.csv' })).body);
    expect(live).toHaveLength(2);
    expect(live[1]).toContain('"Door"');
    const all = lines((await c.call('exportCsv', org, { slug: f.slug, kind: 'scans.csv' }, { query: { includeVoided: '1' } })).body);
    expect(all).toHaveLength(3);
    expect(all.find((r) => r.includes('"Raffle"'))).toContain('"Wrong checkpoint"');
  });

  it('§11: summary.csv has one row per checkpoint with live counts', async () => {
    const rows = lines((await c.call('exportCsv', org, { slug: f.slug, kind: 'summary.csv' })).body);
    expect(rows[0]).toBe('"checkpoint","kind","capacity","live_scans","fill"');
    expect(rows).toContain('"Door","door","","1",""');
    expect(rows).toContain('"Raffle","custom","","0",""');
  });

  it('T-ANA-05: a volunteer cannot export (403); an unknown kind is 404', async () => {
    expect((await c.call('exportCsv', vol, { slug: f.slug, kind: 'participants.csv' })).status).toBe(403);
    expect((await c.call('exportCsv', org, { slug: f.slug, kind: 'secrets.csv' })).status).toBe(404);
  });
});

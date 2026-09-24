import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, obj } from '../fixtures/admin-api';
import { sheetRow } from '../fixtures/ingest';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let org: string;
let requestedSheet: string | null = null;
const header = ['Email Address', 'First Name', 'Applicant ID', 'Status'];
let sheet: string[][] = [header];
const c = adminClient({
  sheetReader: (sheetId) => {
    requestedSheet = sheetId;
    return async () => sheet;
  },
});
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

describe('Sync now (SPEC F10) through the admin API', () => {
  it('F10: without a linked Sheet the sync is 409 NOT_CONFIGURED', async () => {
    const res = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true } });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'NOT_CONFIGURED' });
  });

  it('T-ING-25 (route): link a Sheet by URL, dry-run shows the diff without writing, apply writes and schedules the drain', async () => {
    const link = await c.call('updateEvent', org, { slug: f.slug }, {
      method: 'PATCH',
      body: { sheet: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0' },
    });
    expect(link.status).toBe(200);
    expect(obj(link.body).sheetId).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');

    const r = sheetRow(f.slug, { first_name: 'Newcomer' });
    sheet = [header, [r.email, r.first_name, r.external_id, 'Accepted']];
    const before = await f.pool.query<{ n: number }>('select count(*)::int as n from participants where event_id = $1', [f.e1.id]);
    const dry = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true } });
    expect(requestedSheet).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(dry.body).toMatchObject({ dryRun: true, total: 1, counts: { PASS_QUEUED: 1 } });
    const mid = await f.pool.query<{ n: number }>('select count(*)::int as n from participants where event_id = $1', [f.e1.id]);
    expect(mid.rows[0]?.n).toBe(before.rows[0]?.n);

    const applied = await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: false } });
    expect(applied.body).toMatchObject({ dryRun: false, counts: { PASS_QUEUED: 1 } });
    expect(c.scheduled.length).toBe(1);
    const { rows } = await f.pool.query<{ actor_kind: string }>(`select actor_kind from audit_log where action = 'sheet.sync' and event_id = $1`, [f.e1.id]);
    expect(rows).toEqual([{ actor_kind: 'staff' }]);
  });

  it('F10 / §11: the event reports the last applied sync time (dry runs do not count)', async () => {
    const { rows } = await f.pool.query<{ at: Date }>(`select max(created_at) as at from audit_log where action = 'sheet.sync' and event_id = $1`, [f.e1.id]);
    const res = await c.call('getEvent', org, { slug: f.slug });
    expect(obj(res.body).lastSyncAt).toBe(rows[0]?.at.toISOString());
    await c.call('syncSheet', org, { slug: f.slug }, { body: { dryRun: true } });
    expect(obj((await c.call('getEvent', org, { slug: f.slug })).body).lastSyncAt).toBe(rows[0]?.at.toISOString());
  });

  it('F10: an invalid Sheet link is 400', async () => {
    expect((await c.call('updateEvent', org, { slug: f.slug }, { method: 'PATCH', body: { sheet: 'not a sheet' } })).status).toBe(400);
  });
});

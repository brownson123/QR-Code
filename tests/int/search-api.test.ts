import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toSearchText } from '@/lib/domain/normalize';
import { scanApi } from '../fixtures/scan-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let api: ReturnType<typeof scanApi>;
let vol1: string;
let org1: string;
let vol3: string;

async function person(eventId: string, first: string, last: string, extra: { email?: string; deleted?: boolean } = {}) {
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into participants (event_id, email, first_name, last_name, search_text, status, source, deleted_at)
     values ($1, $2, $3, $4, $5, 'accepted', 'seed', $6) returning id`,
    [eventId, extra.email ?? `${crypto.randomUUID()}@${f.slug}.test`, first, last, toSearchText(`${first} ${last}`), extra.deleted ? new Date() : null],
  );
  return rows[0]?.id ?? '';
}

beforeAll(async () => {
  f = await createStandardFixture();
  api = scanApi();
  [vol1, org1, vol3] = await Promise.all([signInAs(f.staffEmail.vol1), signInAs(f.staffEmail.org1), signInAs(f.staffEmail.vol3)]);
  await person(f.e1.id, 'Zoë', 'Quinn');
  await person(f.e1.id, 'Kelly', "O'Brien");
  await person(f.e1.id, 'Adebayo', 'Okafor', { email: `adebayo.okafor@${f.slug}.test` });
  await person(f.e1.id, '李雷', '');
  await person(f.e2.id, 'Onlyin', 'Eventtwo');
  await person(f.e1.id, 'Ghost', 'Removed', { deleted: true });
  for (let i = 0; i < 30; i++) await person(f.e1.id, 'Matchy', `Person${i}`);
});
afterAll(async () => {
  await f.close();
});

const names = (body: Record<string, unknown>) => (body.results as Array<{ displayName: string }>).map((r) => r.displayName);

describe('manual search (SPEC §10.4)', () => {
  it('T-SRCH-02: zoe, obrien, ade (Adebayo) and 李 each find their person', async () => {
    expect(names((await api.search(vol1, f.slug, 'zoe')).body)).toContain('Zoë Quinn');
    expect(names((await api.search(vol1, f.slug, 'obrien')).body)).toContain("Kelly O'Brien");
    expect(names((await api.search(vol1, f.slug, 'ade')).body)).toContain('Adebayo Okafor');
    expect(names((await api.search(vol1, f.slug, '李')).body)).toContain('李雷');
  });

  it('T-SRCH-03: a 1-character (non-CJK) query is 400', async () => {
    expect((await api.search(vol1, f.slug, 'a')).status).toBe(400);
  });

  it('T-SRCH-04: 30 matching names return 10 results', async () => {
    const { status, body } = await api.search(vol1, f.slug, 'matchy');
    expect(status).toBe(200);
    expect(names(body)).toHaveLength(10);
  });

  it('T-SRCH-05: a name that exists only in E2 is not returned from E1; deleted people never are', async () => {
    expect(names((await api.search(vol1, f.slug, 'onlyin')).body)).toEqual([]);
    expect(names((await api.search(vol1, f.slug, 'ghost')).body)).toEqual([]);
  });

  it('T-SRCH-06: volunteers see a masked email; organizers see it in full', async () => {
    const asVol = (await api.search(vol1, f.slug, 'adebayo')).body.results as Array<{ email: string }>;
    const asOrg = (await api.search(org1, f.slug, 'adebayo')).body.results as Array<{ email: string }>;
    expect(asVol[0]?.email).toBe(`a***@${f.slug}.test`);
    expect(asOrg[0]?.email).toBe(`adebayo.okafor@${f.slug}.test`);
  });

  it('T-SRCH-07 (API half): each row says whether the person already has a live scan at the selected checkpoint', async () => {
    await f.checkIn(f.p.A, f.token.A);
    const rows = (await api.search(vol1, f.slug, 'ada fixture', f.cp.D)).body.results as Array<{ id: string; scannedHere: boolean }>;
    expect(rows.find((r) => r.id === f.p.A)?.scannedHere).toBe(true);
    const lunch = (await api.search(vol1, f.slug, 'ada fixture', f.cp.L)).body.results as Array<{ id: string; scannedHere: boolean }>;
    expect(lunch.find((r) => r.id === f.p.A)?.scannedHere).toBe(false);
  });

  it('I-5: anonymous → 401; staff of another event → 403 (no participant data)', async () => {
    expect((await api.search(null, f.slug, 'zoe')).status).toBe(401);
    const other = await api.search(vol3, f.slug, 'zoe');
    expect(other.status).toBe(403);
    expect(other.body).not.toHaveProperty('results');
  });
});

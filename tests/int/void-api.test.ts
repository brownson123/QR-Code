import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanApi } from '../fixtures/scan-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let api: ReturnType<typeof scanApi>;
let vol1: string;
let vol3: string;
beforeAll(async () => {
  f = await createStandardFixture();
  api = scanApi();
  [vol1, vol3] = await Promise.all([signInAs(f.staffEmail.vol1), signInAs(f.staffEmail.vol3)]);
});
afterAll(async () => {
  await f.close();
});

describe('POST /api/scans/[id]/void (SPEC F11)', () => {
  it('T-SCAN-29: a missing reason or a 2-char reason is 400; nothing is voided', async () => {
    const scan = await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.A });
    expect((await api.voidScan(vol1, scan.scanId ?? '', {})).status).toBe(400);
    expect((await api.voidScan(vol1, scan.scanId ?? '', { reason: 'ok' })).status).toBe(400);
    expect((await api.voidScan(vol1, scan.scanId ?? '', { reason: 'x'.repeat(201) })).status).toBe(400);
    const { rows } = await f.pool.query('select 1 from scans where id = $1 and voided_at is null', [scan.scanId]);
    expect(rows).toHaveLength(1);
  });

  it('T-SCAN-28 (route): own recent scan → VOIDED; other event → FORBIDDEN; anonymous → 401; bad id → 400', async () => {
    const scan = await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.B });
    expect((await api.voidScan(null, scan.scanId ?? '', { reason: 'Test scan' })).status).toBe(401);
    expect((await api.voidScan(vol3, scan.scanId ?? '', { reason: 'Test scan' })).body).toEqual({ code: 'FORBIDDEN' });
    expect((await api.voidScan(vol1, scan.scanId ?? '', { reason: 'Test scan' })).body).toEqual({ code: 'VOIDED' });
    expect((await api.voidScan(vol1, 'not-a-uuid', { reason: 'Test scan' })).status).toBe(400);
  });
});

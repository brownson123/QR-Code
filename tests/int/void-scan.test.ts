import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
beforeEach(async () => {
  f = await createStandardFixture();
});
afterEach(async () => {
  await f.close();
});

// Postgres has no injectable clock; age a scan by moving scanned_at back instead.
async function scanAged(token: string, staff: string, ageSeconds: number): Promise<string> {
  const r = await f.scan({ cp: f.cp.R, staff, token });
  if (!r.scanId) throw new Error(`scan failed: ${r.code}`);
  await f.pool.query(`update scans set scanned_at = now() - make_interval(secs => $2) where id = $1`, [r.scanId, ageSeconds]);
  return r.scanId;
}

describe('void_scan (SPEC F11)', () => {
  it("T-SCAN-28: volunteer voids own scan at 119 s; not at 121 s; not vol2's scan", async () => {
    expect((await f.voidScan(await scanAged(f.token.A, f.staff.vol1, 119), f.staff.vol1)).code).toBe('VOIDED');
    expect((await f.voidScan(await scanAged(f.token.B, f.staff.vol1, 121), f.staff.vol1)).code).toBe('FORBIDDEN');
    expect((await f.voidScan(await scanAged(f.token.N, f.staff.vol2, 5), f.staff.vol1)).code).toBe('FORBIDDEN');
  });

  it('T-SCAN-28: organizer voids all of those cases', async () => {
    expect((await f.voidScan(await scanAged(f.token.A, f.staff.org1, 119), f.staff.org1)).code).toBe('VOIDED');
    expect((await f.voidScan(await scanAged(f.token.B, f.staff.vol1, 121), f.staff.org1)).code).toBe('VOIDED');
    expect((await f.voidScan(await scanAged(f.token.N, f.staff.vol2, 5), f.staff.org1)).code).toBe('VOIDED');
  });

  it('T-SCAN-28: voiding twice is ALREADY_VOIDED; unknown id NOT_FOUND; other-event staff FORBIDDEN', async () => {
    const id = await scanAged(f.token.A, f.staff.vol1, 1);
    expect((await f.voidScan(id, f.staff.vol3)).code).toBe('FORBIDDEN');
    expect((await f.voidScan(id, f.staff.vol1)).code).toBe('VOIDED');
    expect((await f.voidScan(id, f.staff.org1)).code).toBe('ALREADY_VOIDED');
    expect((await f.voidScan(randomUUID(), f.staff.org1)).code).toBe('NOT_FOUND');
  });

  it('T-SCAN-28: a void sets voided_* fields and writes an audit_log row without the reason text (I-11)', async () => {
    const id = await scanAged(f.token.A, f.staff.vol1, 1);
    await f.voidScan(id, f.staff.vol1, 'Wrong person: Ada Fixture');
    const { rows: scan } = await f.pool.query<{ voided_by: string; void_reason: string; has_at: boolean }>(
      'select voided_by, void_reason, voided_at is not null as has_at from scans where id = $1',
      [id],
    );
    expect(scan[0]).toEqual({ voided_by: f.staff.vol1, void_reason: 'Wrong person: Ada Fixture', has_at: true });
    const { rows: audit } = await f.pool.query<{ actor_kind: string; actor_user_id: string; event_id: string; detail: unknown }>(
      `select actor_kind, actor_user_id, event_id, detail from audit_log where action = 'scan.void' and subject_id = $1`,
      [id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_kind: 'staff', actor_user_id: f.staff.vol1, event_id: f.e1.id });
    expect(JSON.stringify(audit[0]?.detail)).not.toMatch(/Ada|Wrong person/);
  });
});

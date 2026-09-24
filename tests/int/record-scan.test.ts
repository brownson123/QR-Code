import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
beforeEach(async () => {
  f = await createStandardFixture();
});
afterEach(async () => {
  await f.close();
});

async function counts(participantId: string, checkpointId: string) {
  const { rows } = await f.pool.query<{ live: number; voided: number }>(
    `select count(*) filter (where voided_at is null)::int as live,
            count(*) filter (where voided_at is not null)::int as voided
       from scans where participant_id = $1 and checkpoint_id = $2`,
    [participantId, checkpointId],
  );
  return rows[0] ?? { live: 0, voided: 0 };
}

describe('record_scan (SPEC §8)', () => {
  it('T-SCAN-01: A at D is ACCEPTED with server time, ignoring a 1999 client time', async () => {
    const r = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A, clientScannedAt: '1999-01-01T00:00:00Z' });
    expect(r.code).toBe('ACCEPTED');
    expect(r.replayed).toBe(false);
    const { rows } = await f.pool.query<{ method: string; drift: number; client_year: number }>(
      `select method, abs(extract(epoch from now() - scanned_at)) as drift,
              extract(year from client_scanned_at)::int as client_year
         from scans where participant_id = $1 and checkpoint_id = $2 and voided_at is null`,
      [f.p.A, f.cp.D],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.method).toBe('qr');
    expect(Number(rows[0]?.drift)).toBeLessThan(2);
    expect(rows[0]?.client_year).toBe(1999);
  });

  it('T-SCAN-02: A at D again is ALREADY_SCANNED with who/when; scannedByMe per staff', async () => {
    await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A });
    const same = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A });
    expect(same.code).toBe('ALREADY_SCANNED');
    expect(same.previous?.scannedByName).toBe('Vol One');
    expect(same.previous?.scannedByMe).toBe(true);
    const other = await f.scan({ cp: f.cp.D, staff: f.staff.vol2, token: f.token.A });
    expect(other.code).toBe('ALREADY_SCANNED');
    expect(other.previous?.scannedByMe).toBe(false);
    expect(await counts(f.p.A, f.cp.D)).toEqual({ live: 1, voided: 0 });
  });

  it('T-SCAN-03: a random well-formed token is NOT_FOUND', async () => {
    const r = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: generateToken() });
    expect(r.code).toBe('NOT_FOUND');
  });

  it("T-SCAN-04: Rv's old token is REVOKED, reissued, rotated", async () => {
    const r = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.rvOldToken });
    expect(r).toMatchObject({ code: 'REVOKED', reissued: true, revokeReason: 'rotated' });
  });

  it("T-SCAN-05: Wd's token is REVOKED, not reissued, status_change", async () => {
    const r = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.Wd });
    expect(r).toMatchObject({ code: 'REVOKED', reissued: false, revokeReason: 'status_change' });
  });

  it('T-SCAN-06: waitlisted C (manual) is NOT_ACCEPTED', async () => {
    const r = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, participantId: f.p.C });
    expect(r.code).toBe('NOT_ACCEPTED');
    expect(r.participant?.status).toBe('waitlisted');
  });

  it("T-SCAN-07: X's token at D is WRONG_EVENT with the other event's name and no participant", async () => {
    const r = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.X });
    expect(r.code).toBe('WRONG_EVENT');
    expect(r.otherEvent).toBe(f.e2.name);
    expect(r.participant).toBeUndefined();
  });

  it('T-SCAN-08: A at L before door, at D, at L, at L', async () => {
    expect((await f.scan({ cp: f.cp.L, staff: f.staff.vol1, token: f.token.A })).code).toBe('NOT_CHECKED_IN');
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A })).code).toBe('ACCEPTED');
    const lunch = await f.scan({ cp: f.cp.L, staff: f.staff.vol1, token: f.token.A });
    expect(lunch.code).toBe('ACCEPTED');
    expect(lunch.participant?.dietaryNotes).toBe('Vegetarian');
    expect((await f.scan({ cp: f.cp.L, staff: f.staff.vol1, token: f.token.A })).code).toBe('ALREADY_SCANNED');
  });

  it('T-SCAN-09: A at R (requires_checkin = false) without door is ACCEPTED', async () => {
    expect((await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.A })).code).toBe('ACCEPTED');
  });

  it('T-SCAN-10: closed D gives CHECKPOINT_CLOSED and writes nothing', async () => {
    await f.pool.query('update checkpoints set is_open = false where id = $1', [f.cp.D]);
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.B })).code).toBe('CHECKPOINT_CLOSED');
    expect(await counts(f.p.B, f.cp.D)).toEqual({ live: 0, voided: 0 });
  });

  it('T-SCAN-11: already-scanned beats capacity', async () => {
    await f.checkIn(f.p.A);
    await f.checkIn(f.p.B);
    expect((await f.scan({ cp: f.cp.W, staff: f.staff.vol1, token: f.token.A })).code).toBe('ACCEPTED');
    expect((await f.scan({ cp: f.cp.W, staff: f.staff.vol1, token: f.token.B })).code).toBe('ACCEPTED');
    expect((await f.scan({ cp: f.cp.W, staff: f.staff.vol1, token: f.token.A })).code).toBe('ALREADY_SCANNED');
  });

  it('T-SCAN-12: third distinct participant at W (cap 2) is CAPACITY_REACHED', async () => {
    for (const id of [f.p.A, f.p.B, f.p.N]) await f.checkIn(id);
    await f.scan({ cp: f.cp.W, staff: f.staff.vol1, token: f.token.A });
    await f.scan({ cp: f.cp.W, staff: f.staff.vol1, token: f.token.B });
    const r = await f.scan({ cp: f.cp.W, staff: f.staff.vol1, token: f.token.N });
    expect(r).toMatchObject({ code: 'CAPACITY_REACHED', capacity: 2 });
    expect(await counts(f.p.N, f.cp.W)).toEqual({ live: 0, voided: 0 });
  });

  it('T-SCAN-13: voiding frees the once-per-checkpoint slot', async () => {
    await f.checkIn(f.p.A);
    const first = await f.scan({ cp: f.cp.L, staff: f.staff.vol1, token: f.token.A });
    expect((await f.voidScan(first.scanId ?? '', f.staff.vol1)).code).toBe('VOIDED');
    expect((await f.scan({ cp: f.cp.L, staff: f.staff.vol1, token: f.token.A })).code).toBe('ACCEPTED');
    expect(await counts(f.p.A, f.cp.L)).toEqual({ live: 1, voided: 1 });
  });

  it('T-SCAN-14: voided scans free capacity', async () => {
    for (const id of [f.p.A, f.p.B, f.p.N]) await f.checkIn(id);
    await f.scan({ cp: f.cp.W, staff: f.staff.vol1, token: f.token.A });
    const b = await f.scan({ cp: f.cp.W, staff: f.staff.vol1, token: f.token.B });
    expect((await f.voidScan(b.scanId ?? '', f.staff.vol1)).code).toBe('VOIDED');
    expect((await f.scan({ cp: f.cp.W, staff: f.staff.vol1, token: f.token.N })).code).toBe('ACCEPTED');
  });

  it("T-SCAN-15: voiding A's door scan does not cascade to lunch", async () => {
    const door = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A });
    expect((await f.scan({ cp: f.cp.L, staff: f.staff.vol1, token: f.token.A })).code).toBe('ACCEPTED');
    expect((await f.voidScan(door.scanId ?? '', f.staff.org1)).code).toBe('VOIDED');
    expect(await counts(f.p.A, f.cp.L)).toEqual({ live: 1, voided: 0 });
  });

  it('T-SCAN-16: vol3 (E2 only) scanning at D is FORBIDDEN', async () => {
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol3, token: f.token.A })).code).toBe('FORBIDDEN');
    expect(await counts(f.p.A, f.cp.D)).toEqual({ live: 0, voided: 0 });
  });

  it('T-SCAN-17: removing vol1 from staff is FORBIDDEN on the very next call', async () => {
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A })).code).toBe('ACCEPTED');
    await f.pool.query('delete from event_staff where event_id = $1 and user_id = $2', [f.e1.id, f.staff.vol1]);
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.B })).code).toBe('FORBIDDEN');
  });

  it('T-SCAN-18: manual path gives the same codes for 01, 02, 06, 08 with method=manual, no pass_id', async () => {
    const a = { cp: f.cp.D, staff: f.staff.vol1, participantId: f.p.A };
    expect((await f.scan(a)).code).toBe('ACCEPTED');
    expect((await f.scan(a)).code).toBe('ALREADY_SCANNED');
    expect((await f.scan({ ...a, participantId: f.p.C })).code).toBe('NOT_ACCEPTED');
    const bl = { cp: f.cp.L, staff: f.staff.vol1, participantId: f.p.B };
    expect((await f.scan(bl)).code).toBe('NOT_CHECKED_IN');
    expect((await f.scan({ ...bl, cp: f.cp.D })).code).toBe('ACCEPTED');
    expect((await f.scan(bl)).code).toBe('ACCEPTED');
    expect((await f.scan(bl)).code).toBe('ALREADY_SCANNED');
    const { rows } = await f.pool.query<{ method: string; pass_id: string | null }>(
      'select method, pass_id from scans where participant_id = any($1)',
      [[f.p.A, f.p.B]],
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toEqual({ method: 'manual', pass_id: null });
  });

  it('T-SCAN-19: dietaryNotes present at meal L, absent at D, W, R', async () => {
    const d = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A });
    const l = await f.scan({ cp: f.cp.L, staff: f.staff.vol1, token: f.token.A });
    const w = await f.scan({ cp: f.cp.W, staff: f.staff.vol1, token: f.token.A });
    const r = await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.A });
    expect(l.participant?.dietaryNotes).toBe('Vegetarian');
    for (const res of [d, w, r]) {
      expect(res.code).toBe('ACCEPTED');
      expect(res.participant?.dietaryNotes ?? null).toBeNull();
    }
  });

  it('T-SCAN-20: the same clientScanId twice by vol1 is replayed, one row', async () => {
    const id = randomUUID();
    const first = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A, clientScanId: id });
    const second = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A, clientScanId: id });
    expect(first).toMatchObject({ code: 'ACCEPTED', replayed: false });
    expect(second).toMatchObject({ code: 'ACCEPTED', replayed: true, scanId: first.scanId });
    expect(await counts(f.p.A, f.cp.D)).toEqual({ live: 1, voided: 0 });
  });

  it('T-SCAN-21: the same clientScanId reused by vol2 is CLIENT_ID_CONFLICT, no new row', async () => {
    const id = randomUUID();
    await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.A, clientScanId: id });
    const r = await f.scan({ cp: f.cp.D, staff: f.staff.vol2, token: f.token.B, clientScanId: id });
    expect(r.code).toBe('CLIENT_ID_CONFLICT');
    expect(await counts(f.p.B, f.cp.D)).toEqual({ live: 0, voided: 0 });
  });

  it('T-SCAN-22: a raw insert joining E2 participant X to E1 checkpoint D violates a FK', async () => {
    await expect(
      f.pool.query(
        `insert into scans (event_id, participant_id, checkpoint_id, method, scanned_by, client_scan_id)
         values ($1, $2, $3, 'manual', $4, gen_random_uuid())`,
        [f.e1.id, f.p.X, f.cp.D, f.staff.org1],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('T-SCAN-24: record_scan as anon and as authenticated is permission denied', async () => {
    for (const role of ['anon', 'authenticated']) {
      const client = await f.pool.connect();
      try {
        await client.query('begin');
        await client.query(`set local role ${role}`);
        await expect(
          client.query('select record_scan($1, $2, $3::scan_method, $4, null, gen_random_uuid(), now())', [
            f.cp.D,
            f.staff.vol1,
            'qr',
            sha256hex(f.token.A),
          ]),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await client.query('rollback');
        client.release();
      }
    }
  });

  it("T-SCAN-25: X's revoked old token at D is REVOKED (step 5 before 6)", async () => {
    await f.issuePass(f.p.X);
    const r = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.X });
    expect(r).toMatchObject({ code: 'REVOKED', reissued: true });
  });

  it('T-SCAN-26: C at a closed checkpoint is NOT_ACCEPTED (step 7 before 8)', async () => {
    await f.pool.query('update checkpoints set is_open = false where id = $1', [f.cp.D]);
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, participantId: f.p.C })).code).toBe('NOT_ACCEPTED');
  });

  it('T-SCAN-27: deleted participant: old token REVOKED (deleted); manual by id NOT_FOUND', async () => {
    // Tombstone per §5.1 (the admin delete flow arrives in S6).
    await f.pool.query(
      `update participants set deleted_at = now(), first_name = 'Deleted', last_name = '',
              email = 'deleted+' || id || '@invalid', search_text = '', dietary_notes = null,
              linkedin_url = null, photo_path = null
        where id = $1`,
      [f.p.B],
    );
    await f.pool.query(
      `update passes set revoked_at = now(), revoke_reason = 'deleted' where participant_id = $1 and revoked_at is null`,
      [f.p.B],
    );
    const qr = await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.B });
    expect(qr).toMatchObject({ code: 'REVOKED', revokeReason: 'deleted', reissued: false });
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, participantId: f.p.B })).code).toBe('NOT_FOUND');
  });
});

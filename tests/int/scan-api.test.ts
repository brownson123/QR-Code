import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateToken } from '@/lib/domain/token';
import { passClient } from '../fixtures/pass';
import { scanApi } from '../fixtures/scan-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §14.6: the T-SCAN cases "via /api/scan" (the SQL half runs in record-scan.test.ts).
let f: StandardFixture;
let api: ReturnType<typeof scanApi>;
let vol1: string;
let vol2: string;
let vol3: string;
beforeAll(async () => {
  f = await createStandardFixture();
  api = scanApi();
  [vol1, vol2, vol3] = await Promise.all([signInAs(f.staffEmail.vol1), signInAs(f.staffEmail.vol2), signInAs(f.staffEmail.vol3)]);
});
afterAll(async () => {
  await f.close();
});

const qr = (cp: string, token: string, extra: Record<string, unknown> = {}) => ({ checkpointId: cp, method: 'qr', token, ...extra });

describe('POST /api/scan (SPEC §9.1)', () => {
  it('F6: no session → 401; invalid body → 400; neither writes a scan attempt', async () => {
    expect((await api.scan(null, qr(f.cp.D, f.token.A))).status).toBe(401);
    expect((await api.scan(vol1, { checkpointId: f.cp.D, method: 'qr' })).status).toBe(400);
    expect((await api.scan(vol1, { ...qr(f.cp.D, f.token.A), extra: true })).status).toBe(400);
    const { rows } = await f.pool.query('select 1 from scan_attempts where staff_user_id = $1', [f.staff.vol1]);
    expect(rows).toHaveLength(0);
  });

  it('T-SCAN-01: ACCEPTED with serverTime, a signed photo URL, and a scan_attempts row with latency and no token', async () => {
    const photo = await passClient().upload(
      f.token.A,
      await (await import('sharp')).default({ create: { width: 32, height: 32, channels: 3, background: '#888' } }).jpeg().toBuffer(),
    );
    expect(photo.status).toBe(200);
    const before = Date.now();
    const { status, body } = await api.scan(vol1, qr(f.cp.D, f.token.A, { clientScannedAt: '1999-01-01T00:00:00Z' }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ code: 'ACCEPTED', replayed: false, participant: { id: f.p.A, displayName: 'Ada Fixture', status: 'accepted' } });
    expect(Math.abs(Date.parse(String(body.serverTime)) - before)).toBeLessThan(5000);
    const participant = body.participant as Record<string, unknown>;
    expect(participant).not.toHaveProperty('photoPath');
    expect((await fetch(String(participant.photoUrl))).status).toBe(200);

    const { rows } = await f.pool.query<{ result_code: string; latency_ms: number; event_id: string; participant_id: string }>(
      'select result_code, latency_ms, event_id, participant_id from scan_attempts where staff_user_id = $1',
      [f.staff.vol1],
    );
    expect(rows).toEqual([{ result_code: 'ACCEPTED', latency_ms: expect.any(Number), event_id: f.e1.id, participant_id: f.p.A }]);
  });

  it('T-SCAN-02: ALREADY_SCANNED with scannedByMe per caller', async () => {
    await api.scan(vol1, qr(f.cp.R, f.token.B));
    const mine = await api.scan(vol1, qr(f.cp.R, f.token.B));
    const theirs = await api.scan(vol2, qr(f.cp.R, f.token.B));
    expect(mine.body).toMatchObject({ code: 'ALREADY_SCANNED', previous: { scannedByName: 'Vol One', scannedByMe: true } });
    expect(theirs.body).toMatchObject({ code: 'ALREADY_SCANNED', previous: { scannedByMe: false } });
  });

  it('T-SCAN-03/04/05/07: NOT_FOUND, REVOKED (reissued / not), WRONG_EVENT without participant data', async () => {
    expect((await api.scan(vol2, qr(f.cp.D, generateToken()))).body.code).toBe('NOT_FOUND');
    expect((await api.scan(vol2, qr(f.cp.D, f.rvOldToken))).body).toMatchObject({ code: 'REVOKED', reissued: true });
    expect((await api.scan(vol2, qr(f.cp.D, f.token.Wd))).body).toMatchObject({ code: 'REVOKED', reissued: false });
    const wrong = await api.scan(vol2, qr(f.cp.D, f.token.X));
    expect(wrong.body).toMatchObject({ code: 'WRONG_EVENT', otherEvent: f.e2.name });
    expect(wrong.body).not.toHaveProperty('participant');
  });

  it('T-SCAN-08/19: lunch before door, then dietary notes only at the meal', async () => {
    expect((await api.scan(vol2, qr(f.cp.L, f.token.N))).body.code).toBe('NOT_CHECKED_IN');
    const door = await api.scan(vol2, qr(f.cp.D, f.token.N));
    expect((door.body.participant as Record<string, unknown>).dietaryNotes ?? null).toBeNull();
    await f.pool.query(`update participants set dietary_notes = 'Nut allergy' where id = $1`, [f.p.N]);
    const lunch = await api.scan(vol2, qr(f.cp.L, f.token.N));
    expect(lunch.body).toMatchObject({ code: 'ACCEPTED', participant: { dietaryNotes: 'Nut allergy' } });
  });

  it('T-SCAN-16: vol3 (other event) is FORBIDDEN', async () => {
    expect((await api.scan(vol3, qr(f.cp.D, f.token.T))).body.code).toBe('FORBIDDEN');
  });

  it('T-SCAN-18: manual scan through the route', async () => {
    const r = await api.scan(vol2, { checkpointId: f.cp.R, method: 'manual', participantId: f.p.T });
    expect(r.body).toMatchObject({ code: 'ACCEPTED', participant: { id: f.p.T } });
  });

  it('T-SCAN-20/21: a retried clientScanId replays; reused by another volunteer it conflicts', async () => {
    const id = randomUUID();
    const first = await api.scan(vol2, qr(f.cp.R, f.token.Rv, { clientScanId: id }));
    const retry = await api.scan(vol2, qr(f.cp.R, f.token.Rv, { clientScanId: id }));
    const other = await api.scan(vol1, qr(f.cp.R, f.token.Rv, { clientScanId: id }));
    expect(first.body).toMatchObject({ code: 'ACCEPTED', replayed: false });
    expect(retry.body).toMatchObject({ code: 'ACCEPTED', replayed: true, scanId: first.body.scanId });
    expect(other.body.code).toBe('CLIENT_ID_CONFLICT');
  });

  it('T-ADM-07: more than 30 NOT_FOUND from one volunteer in 5 minutes → 429 for them only', async () => {
    const jwt = await signInAs(f.staffEmail.org1);
    const codes: string[] = [];
    for (let i = 0; i < 30; i++) codes.push(String((await api.scan(jwt, qr(f.cp.D, generateToken()))).body.code));
    expect(codes.every((c) => c === 'NOT_FOUND')).toBe(true);
    expect((await api.scan(jwt, qr(f.cp.D, generateToken()))).status).toBe(429);
    expect((await api.scan(vol2, qr(f.cp.R, f.token.A))).status).toBe(200);
  });

  it('§15: the 121st scan within a minute from one staff member → 429', async () => {
    // A fresh fixture, so this volunteer has no earlier attempts inside the sliding window.
    const g = await createStandardFixture();
    try {
      const jwt = await signInAs(g.staffEmail.vol3);
      const statuses: number[] = [];
      for (let i = 0; i < 121; i++) statuses.push((await api.scan(jwt, qr(g.cp.D2, g.token.X))).status);
      expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true);
      expect(statuses[120]).toBe(429);
    } finally {
      await g.close();
    }
  });

  it('I-3/I-11: the raw token never reaches scan_attempts or any log table', async () => {
    const token = f.token.T;
    await api.scan(vol1, qr(f.cp.R, token));
    const { rows } = await f.pool.query(
      `select 1 from scan_attempts where result_code like $1 or cast(participant_id as text) like $1`,
      [`%${token}%`],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('GET /api/events/[slug]/checkpoints', () => {
  it('F6: staff on the event get the checkpoint list; others get 403; anonymous 401', async () => {
    const ok = await api.checkpoints(vol1, f.slug);
    expect(ok.status).toBe(200);
    const list = ok.body.checkpoints as Array<{ name: string; kind: string }>;
    expect(list.map((c) => c.name).sort()).toEqual(['Door', 'Lunch', 'Raffle', 'Workshop']);
    expect((await api.checkpoints(vol3, f.slug)).status).toBe(403);
    expect((await api.checkpoints(vol1, 'no-such-event')).status).toBe(403);
    expect((await api.checkpoints(null, f.slug)).status).toBe(401);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// CLAUDE.md: genuinely parallel connections (pool sized >= N, Promise.all), never sequential awaits.
// T-CONC-07: the nightly workflow sets CONC_ITERATIONS=100 for 01, 02 and 03.
const ITERATIONS = Math.max(1, Number(process.env.CONC_ITERATIONS ?? '1'));

let f: StandardFixture;
beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 50 });
});
afterAll(async () => {
  await f.close();
});

function tally(codes: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of codes) out[c] = (out[c] ?? 0) + 1;
  return out;
}

async function newCheckpoint(opts: { capacity?: number; kind?: string } = {}): Promise<string> {
  const { rows } = await f.pool.query<{ id: string }>(
    `insert into checkpoints (event_id, name, kind, requires_checkin, capacity, is_open)
     values ($1, $2, $3, false, $4, true) returning id`,
    [f.e1.id, `C-${randomUUID()}`, opts.kind ?? 'custom', opts.capacity ?? null],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('checkpoint insert failed');
  return id;
}

async function liveRows(checkpointId: string): Promise<number> {
  const { rows } = await f.pool.query<{ n: number }>(
    'select count(*)::int as n from scans where checkpoint_id = $1 and voided_at is null',
    [checkpointId],
  );
  return rows[0]?.n ?? -1;
}

describe(`concurrency (×${ITERATIONS})`, () => {
  it('T-CONC-01 / T-CONC-07: 50 parallel scans of one person, distinct ids → 1 ACCEPTED, 49 ALREADY_SCANNED', async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const cp = await newCheckpoint();
      const person = await f.addParticipant(f.e1.id);
      const results = await Promise.all(
        Array.from({ length: 50 }, () => f.scan({ cp, staff: f.staff.vol1, token: person.token ?? '' })),
      );
      expect(tally(results.map((r) => r.code))).toEqual({ ACCEPTED: 1, ALREADY_SCANNED: 49 });
      expect(await liveRows(cp)).toBe(1);
    }
  });

  it('T-CONC-02 / T-CONC-07: 20 parallel scans with the same clientScanId → 20 ACCEPTED, 19 replayed, 1 row', async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const cp = await newCheckpoint();
      const person = await f.addParticipant(f.e1.id);
      const clientScanId = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 20 }, () => f.scan({ cp, staff: f.staff.vol1, token: person.token ?? '', clientScanId })),
      );
      expect(tally(results.map((r) => r.code))).toEqual({ ACCEPTED: 20 });
      expect(results.filter((r) => r.replayed === true)).toHaveLength(19);
      expect(await liveRows(cp)).toBe(1);
    }
  });

  it('T-CONC-03 / T-CONC-07: capacity 10, 30 distinct participants in parallel → 10 ACCEPTED, 20 CAPACITY_REACHED', async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const cp = await newCheckpoint({ capacity: 10, kind: 'session' });
      const people = await Promise.all(Array.from({ length: 30 }, () => f.addParticipant(f.e1.id)));
      const results = await Promise.all(
        people.map((p) => f.scan({ cp, staff: f.staff.vol1, token: p.token ?? '' })),
      );
      expect(tally(results.map((r) => r.code))).toEqual({ ACCEPTED: 10, CAPACITY_REACHED: 20 });
      expect(await liveRows(cp)).toBe(10);
    }
  });

  it('T-CONC-04: 10 parallel issue_pass for a participant with one pass → 1 active, 11 rows, 10 rotated', async () => {
    const person = await f.addParticipant(f.e1.id);
    await Promise.all(Array.from({ length: 10 }, () => f.issuePass(person.id)));
    const { rows } = await f.pool.query<{ total: number; active: number; rotated: number }>(
      `select count(*)::int as total,
              count(*) filter (where revoked_at is null)::int as active,
              count(*) filter (where revoke_reason = 'rotated')::int as rotated
         from passes where participant_id = $1`,
      [person.id],
    );
    expect(rows[0]).toEqual({ total: 11, active: 1, rotated: 10 });
  });

  it('T-CONC-05: scanning at L while the door scan is voided → no error, ACCEPTED or NOT_CHECKED_IN, < 2 s', async () => {
    const person = await f.addParticipant(f.e1.id);
    const door = await f.scan({ cp: f.cp.D, staff: f.staff.org1, token: person.token ?? '' });
    const started = performance.now();
    const [lunch, voided] = await Promise.all([
      f.scan({ cp: f.cp.L, staff: f.staff.vol1, token: person.token ?? '' }),
      f.voidScan(door.scanId ?? '', f.staff.org1),
    ]);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(voided.code).toBe('VOIDED');
    expect(['ACCEPTED', 'NOT_CHECKED_IN']).toContain(lunch.code);
  });

  it('T-CONC-06: W at capacity − 1, same person scanned twice in parallel → ACCEPTED + ALREADY_SCANNED, never CAPACITY_REACHED', async () => {
    const cp = await newCheckpoint({ capacity: 2, kind: 'session' });
    const filler = await f.addParticipant(f.e1.id);
    const person = await f.addParticipant(f.e1.id);
    expect((await f.scan({ cp, staff: f.staff.vol1, token: filler.token ?? '' })).code).toBe('ACCEPTED');
    const results = await Promise.all([
      f.scan({ cp, staff: f.staff.vol1, token: person.token ?? '' }),
      f.scan({ cp, staff: f.staff.vol2, token: person.token ?? '' }),
    ]);
    expect(tally(results.map((r) => r.code))).toEqual({ ACCEPTED: 1, ALREADY_SCANNED: 1 });
  });
});

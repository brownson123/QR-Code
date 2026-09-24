import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient } from '../fixtures/admin-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// T-PERF-02 against local Postgres: 1,000 participants and 5,000 live scans in one event.
// The median of several runs, so one GC pause or cold cache doesn't decide the result.
let f: StandardFixture;
let org: string;
const c = adminClient();

async function median(runs: number, fn: () => Promise<unknown>): Promise<number> {
  await fn(); // warm-up
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] ?? Infinity;
}

beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
  await f.pool.query(`insert into checkpoints (event_id, name, kind, requires_checkin, is_open) values ($1, 'Swag', 'custom', false, true)`, [f.e1.id]);
  await f.pool.query(
    `insert into participants (event_id, external_id, email, first_name, last_name, search_text, status, source)
     select $1, 'perf-' || g, 'perf' || g || '@perf.test', 'Perf', 'P' || g, 'perf p' || g, 'accepted', 'seed'
       from generate_series(1, 1000) g`,
    [f.e1.id],
  );
  // Every perf participant scanned once at each of the 5 checkpoints: 5,000 live scans.
  await f.pool.query(
    `insert into scans (event_id, participant_id, checkpoint_id, method, scanned_by, scanned_at, client_scan_id)
     select $1, p.id, c.id, 'manual', $2, e.starts_at + (random() * interval '6 hours'), gen_random_uuid()
       from participants p cross join checkpoints c join events e on e.id = $1
      where p.event_id = $1 and p.external_id like 'perf-%' and c.event_id = $1`,
    [f.e1.id, f.staff.org1],
  );
  await f.pool.query('analyze participants; analyze scans');
  const { rows } = await f.pool.query<{ n: number }>('select count(*)::int as n from scans where event_id = $1', [f.e1.id]);
  expect(rows[0]?.n).toBe(5000);
});
afterAll(async () => {
  await f.close();
});

describe('dashboard performance (SPEC §14.14)', () => {
  it('T-PERF-02: the dashboard poll query takes < 200 ms', async () => {
    const ms = await median(5, () => f.pool.query('select event_metrics($1, now())', [f.e1.id]));
    expect(ms).toBeLessThan(200);
  });

  it('T-PERF-02: the whole dashboard request (auth + metrics + event) takes < 2 s', async () => {
    const ms = await median(3, async () => {
      const res = await c.call('dashboard', org, { slug: f.slug });
      expect(res.status).toBe(200);
    });
    expect(ms).toBeLessThan(2000);
  });

  it('T-PERF-02: the participants list for 1,000 people takes < 2 s', async () => {
    const ms = await median(3, async () => {
      const res = await c.call('listParticipants', org, { slug: f.slug });
      expect(res.status).toBe(200);
    });
    expect(ms).toBeLessThan(2000);
  });
});

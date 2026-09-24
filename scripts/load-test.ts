// T-PERF-01 harness: N virtual scanners send `scans` door scans over `minutes` to a running app.
// LOCAL ONLY: it seeds its own fixture event in the local database (CLAUDE.md: never a remote
// project), so it refuses any origin that isn't localhost. The real T-PERF-01 run is against a
// Vercel preview wired to a staging database; see docs/launch-checklist.md.
//
//   pnpm load-test                         # 5 scanners, 300 scans, 1 minute, http://localhost:3000
//   pnpm load-test --scanners 5 --scans 300 --minutes 10 --origin http://localhost:3000
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { sessionCookieFor } from '../tests/fixtures/staff';
import { createStandardFixture } from '../tests/fixtures/standard';

const { values } = parseArgs({
  options: {
    origin: { type: 'string', default: 'http://localhost:3000' },
    scanners: { type: 'string', default: '5' },
    scans: { type: 'string', default: '300' },
    minutes: { type: 'string', default: '1' },
  },
});
const origin = new URL(values.origin);
if (!['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('load-test is local-only (it seeds the local database)');
const scanners = Number(values.scanners);
const total = Number(values.scans);
const intervalMs = (Number(values.minutes) * 60_000) / (total / scanners);

const f = await createStandardFixture({ poolSize: 8 });
console.log(`seeding ${total} accepted participants with passes in ${f.slug}…`);
const tokens: string[] = [];
for (let i = 0; i < total; i++) {
  const { token } = await f.addParticipant(f.e1.id);
  if (token) tokens.push(token);
}
const staffEmails = [f.staffEmail.org1, f.staffEmail.vol1, f.staffEmail.vol2];
const cookies = await Promise.all(staffEmails.map((e) => sessionCookieFor(e)));

async function scan(cookie: string, token: string): Promise<{ ms: number; status: number; code: string }> {
  const t = performance.now();
  const res = await fetch(new URL('/api/scan', origin), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ checkpointId: f.cp.D, method: 'qr', token, clientScanId: randomUUID(), clientScannedAt: new Date().toISOString() }),
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  return { ms: performance.now() - t, status: res.status, code: body.code ?? `HTTP_${res.status}` };
}

// Warm-up (dev server compiles the route on first hit), not counted.
await scan(cookies[0] ?? '', 'A'.repeat(32));

const results: Array<{ ms: number; status: number; code: string }> = [];
let next = 0;
await Promise.all(
  Array.from({ length: scanners }, async (_, s) => {
    const cookie = cookies[s % cookies.length] ?? '';
    for (;;) {
      const i = next++;
      const token = tokens[i];
      if (token === undefined) return;
      results.push(await scan(cookie, token));
      await new Promise((r) => setTimeout(r, intervalMs * (0.5 + Math.random())));
    }
  }),
);

const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))] ?? NaN);
const codes: Record<string, number> = {};
for (const r of results) codes[r.code] = (codes[r.code] ?? 0) + 1;
const errors = results.filter((r) => r.status >= 400).length;
console.log(JSON.stringify({ scans: results.length, scanners, p50: pct(50), p95: pct(95), max: pct(100), errors, codes }, null, 2));
await f.close();
if (errors > 0 || pct(95) >= 700) {
  console.error('T-PERF-01 target missed: p95 must be < 700 ms with 0 errors');
  process.exit(1);
}

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookieFor } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// T-ADM-01 (API half) and T-ANA-05: every /api/admin route, called with a REAL session cookie, refuses
// a volunteer of the event and an organizer of a different event. Enumerated from the file system.
const ADMIN_DIR = join(process.cwd(), 'app', 'api', 'admin');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Handler = (request: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === 'route.ts' ? [full] : [];
  });
}

let f: StandardFixture;
let volunteer: string;
let otherOrganizer: string;
beforeAll(async () => {
  f = await createStandardFixture();
  await f.pool.query(`update event_staff set role = 'organizer' where event_id = $1 and user_id = $2`, [f.e2.id, f.staff.vol3]);
  [volunteer, otherOrganizer] = await Promise.all([sessionCookieFor(f.staffEmail.vol1), sessionCookieFor(f.staffEmail.vol3)]);
});
afterAll(async () => {
  await f.close();
});

describe('organizer-only API (SPEC §3, §11)', () => {
  it('T-ADM-01 / T-ANA-05: a volunteer, and an organizer of another event, get 403 from every /api/admin route', async () => {
    const files = routeFiles(ADMIN_DIR);
    expect(files.length).toBeGreaterThanOrEqual(12);
    const params = {
      slug: f.slug,
      id: f.p.A,
      userId: f.staff.vol2,
      email: 'someone@example.test',
      kind: 'participants.csv',
    };
    const checked: string[] = [];
    for (const file of files) {
      const segments = relative(ADMIN_DIR, file).split(sep).slice(0, -1);
      const path = `/api/admin/${segments.join('/')}`;
      const mod: Record<string, unknown> = await import(/* @vite-ignore */ file);
      for (const method of METHODS) {
        const handler = mod[method];
        if (typeof handler !== 'function') continue;
        for (const [who, cookie] of [
          ['volunteer', volunteer],
          ['other-organizer', otherOrganizer],
        ] as const) {
          const init: RequestInit = { method, headers: { cookie, 'content-type': 'application/json' } };
          if (method !== 'GET' && method !== 'DELETE') init.body = '{}';
          const res = await (handler as Handler)(new Request(`http://localhost${path}`, init), { params: Promise.resolve(params) });
          expect(res.status, `${who} ${method} ${path}`).toBe(403);
          checked.push(`${who} ${method} ${path}`);
        }
      }
    }
    expect(checked.length).toBeGreaterThanOrEqual(24);
    // Nothing changed as a side effect.
    const { rows } = await f.pool.query('select 1 from participants where id = $1 and deleted_at is null', [f.p.A]);
    expect(rows).toHaveLength(1);
  });
});

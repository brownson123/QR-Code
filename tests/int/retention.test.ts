import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/retention/route';
import type { Database } from '@/lib/db/types.gen';
import { runRetention } from '@/lib/privacy/retention';
import { PHOTO_BUCKET, photoPath } from '@/lib/storage/photos';
import { requireEnv } from '../fixtures/db';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// SPEC §15 retention: photos and dietary notes are deleted 30 days after the event ends.
const DAY = 86_400_000;
const db = createClient<Database>(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const call = (authorization?: string) =>
  POST(new Request('http://localhost/api/retention', { method: 'POST', headers: authorization ? { authorization } : {} }), { params: Promise.resolve({}) });

let f: StandardFixture;
const now = new Date();
beforeAll(async () => {
  f = await createStandardFixture();
  // E1 ended exactly 30 days ago (due); E2 ended 29 days ago (not yet due).
  const setEnd = (id: string, endsAt: Date) =>
    f.pool.query('update events set starts_at = $2, ends_at = $3 where id = $1', [id, new Date(endsAt.getTime() - DAY), endsAt]);
  await setEnd(f.e1.id, new Date(now.getTime() - 30 * DAY));
  await setEnd(f.e2.id, new Date(now.getTime() - 29 * DAY));
  for (const [eventId, pid] of [
    [f.e1.id, f.p.A],
    [f.e2.id, f.p.X],
  ] as const) {
    const path = photoPath(eventId, pid);
    const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    await f.pool.query(`update participants set photo_path = $2, photo_updated_at = now(), dietary_notes = 'Nut allergy' where id = $1`, [pid, path]);
  }
});
afterAll(async () => {
  await f.close();
});

const person = async (id: string) =>
  (await f.pool.query<{ photo_path: string | null; photo_updated_at: Date | null; dietary_notes: string | null; first_name: string }>(
    'select photo_path, photo_updated_at, dietary_notes, first_name from participants where id = $1',
    [id],
  )).rows[0];
const objectExists = async (eventId: string, pid: string) => {
  const { data } = await db.storage.from(PHOTO_BUCKET).list(eventId);
  return (data ?? []).some((o) => o.name === `${pid}.jpg`);
};

describe('retention (SPEC §15)', () => {
  it('T-PRIV-01: the job refuses without DRAIN_SECRET', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
    expect((await person(f.p.A))?.dietary_notes).toBe('Nut allergy');
  });

  it('T-PRIV-01: at ends_at + 30 d, photos are deleted from storage and photo_path/dietary_notes are nulled; younger events untouched', async () => {
    const res = await call(`Bearer ${requireEnv('DRAIN_SECRET')}`);
    expect(res.status).toBe(200);

    const a = await person(f.p.A);
    expect(a).toMatchObject({ photo_path: null, photo_updated_at: null, dietary_notes: null, first_name: 'Ada' });
    expect(await objectExists(f.e1.id, f.p.A)).toBe(false);

    const x = await person(f.p.X);
    expect(x?.photo_path).toBe(photoPath(f.e2.id, f.p.X));
    expect(x?.dietary_notes).toBe('Nut allergy');
    expect(await objectExists(f.e2.id, f.p.X)).toBe(true);

    const { rows } = await f.pool.query<{ actor_kind: string; detail: { participants: number; photos: number } }>(
      `select actor_kind, detail from audit_log where event_id = $1 and action = 'privacy.retention'`,
      [f.e1.id],
    );
    expect(rows).toEqual([{ actor_kind: 'system', detail: { participants: 1, photos: 1 } }]);
  });

  it('T-PRIV-02: running it again changes nothing and writes no second audit row', async () => {
    const second = await runRetention(db, now);
    expect(second.events.find((e) => e.eventId === f.e1.id)).toBeUndefined();
    expect((await person(f.p.A))?.dietary_notes).toBeNull();
    const { rows } = await f.pool.query(`select 1 from audit_log where event_id = $1 and action = 'privacy.retention'`, [f.e1.id]);
    expect(rows).toHaveLength(1);
  });

  it('T-PRIV-01: one day later E2 is due too', async () => {
    const later = await runRetention(db, new Date(now.getTime() + DAY));
    expect(later.events.find((e) => e.eventId === f.e2.id)).toEqual({ eventId: f.e2.id, participants: 1, photos: 1 });
    expect(await objectExists(f.e2.id, f.p.X)).toBe(false);
  });
});

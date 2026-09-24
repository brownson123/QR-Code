import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consumeInvites } from '@/lib/auth/invites';
import { requireStaffBySlug } from '@/lib/auth/staff';
import { normalizeEmail } from '@/lib/domain/normalize';
import { requireEnv } from '../fixtures/db';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
const db = serviceClient();
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

describe('staff onboarding and authorization (SPEC F9, §3)', () => {
  it('F9: first sign-in consumes every invite for the verified, lowercased email, then deletes them', async () => {
    const email = normalizeEmail(` New.Staff+${f.slug}@Example.TEST `);
    await f.pool.query(`insert into staff_invites (event_id, email, role) values ($1, $2, 'volunteer'), ($3, $2, 'organizer')`, [
      f.e1.id,
      email,
      f.e2.id,
    ]);
    const admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });
    const { data } = await admin.auth.admin.createUser({ email: ` New.Staff+${f.slug}@Example.TEST `.trim(), email_confirm: true });
    const user = data.user;
    if (!user) throw new Error('no user');

    expect(await consumeInvites(db, { id: user.id, email: user.email ?? null })).toBe(2);
    const { rows } = await f.pool.query<{ event_id: string; role: string }>(
      'select event_id, role from event_staff where user_id = $1 order by role',
      [user.id],
    );
    expect(rows).toEqual([
      { event_id: f.e2.id, role: 'organizer' },
      { event_id: f.e1.id, role: 'volunteer' },
    ]);
    const { rows: left } = await f.pool.query('select 1 from staff_invites where email = $1', [email]);
    expect(left).toHaveLength(0);
    expect(await consumeInvites(db, { id: user.id, email: user.email ?? null })).toBe(0);
  });

  it('§3: requireStaffBySlug returns the role, honours a required role, and hides other events', async () => {
    expect(await requireStaffBySlug(db, f.staff.org1, f.slug)).toEqual({ eventId: f.e1.id, role: 'organizer' });
    expect(await requireStaffBySlug(db, f.staff.vol1, f.slug)).toEqual({ eventId: f.e1.id, role: 'volunteer' });
    expect(await requireStaffBySlug(db, f.staff.vol1, f.slug, 'organizer')).toBeNull();
    expect(await requireStaffBySlug(db, f.staff.vol3, f.slug)).toBeNull();
    expect(await requireStaffBySlug(db, f.staff.org1, 'no-such-event')).toBeNull();
  });

  it('T-SCAN-17 (auth): removing a staff member takes effect on their very next check (no role cache)', async () => {
    expect(await requireStaffBySlug(db, f.staff.vol2, f.slug)).not.toBeNull();
    await f.pool.query('delete from event_staff where event_id = $1 and user_id = $2', [f.e1.id, f.staff.vol2]);
    expect(await requireStaffBySlug(db, f.staff.vol2, f.slug)).toBeNull();
  });
});

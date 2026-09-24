import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, obj } from '../fixtures/admin-api';
import { signInAs } from '../fixtures/staff';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let org: string;
const c = adminClient();
beforeAll(async () => {
  f = await createStandardFixture();
  org = await signInAs(f.staffEmail.org1);
});
afterAll(async () => {
  await f.close();
});

describe('staff admin (SPEC F9)', () => {
  it('F9: inviting an existing user adds them directly; a new email becomes a pending invite (normalized)', async () => {
    const existing = await c.call('inviteStaff', org, { slug: f.slug }, { body: { email: f.staffEmail.vol3.toUpperCase(), role: 'volunteer' } });
    expect(existing.body).toEqual({ code: 'ADDED' });
    const fresh = await c.call('inviteStaff', org, { slug: f.slug }, { body: { email: ` New+${f.slug}@Example.TEST `, role: 'organizer' } });
    expect(fresh.body).toEqual({ code: 'INVITED' });
    const list = await c.call('listStaff', org, { slug: f.slug });
    const staff = obj(list.body).staff as Array<{ userId: string; role: string; displayName: string | null }>;
    expect(staff.find((s) => s.userId === f.staff.vol3)).toMatchObject({ role: 'volunteer', displayName: 'Vol Three' });
    expect(obj(list.body).invites).toEqual([{ email: `new+${f.slug}@example.test`, role: 'organizer' }]);
    expect((await c.call('inviteStaff', org, { slug: f.slug }, { body: { email: 'nope', role: 'volunteer' } })).status).toBe(400);
    const cancelled = await c.call('cancelInvite', org, { slug: f.slug, email: `new+${f.slug}@example.test` }, { method: 'DELETE' });
    expect(cancelled.status).toBe(200);
  });

  it('F9: removing a volunteer takes effect on their next scan; the last organizer cannot be removed', async () => {
    expect((await c.call('removeStaff', org, { slug: f.slug, userId: f.staff.vol2 }, { method: 'DELETE' })).body).toEqual({ code: 'REMOVED' });
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol2, token: f.token.A })).code).toBe('FORBIDDEN');
    const last = await c.call('removeStaff', org, { slug: f.slug, userId: f.staff.org1 }, { method: 'DELETE' });
    expect(last.status).toBe(409);
    expect(last.body).toEqual({ code: 'LAST_ORGANIZER' });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, obj } from '../fixtures/admin-api';
import { onlyEmailTo, tokenFromEmail } from '../fixtures/mail';
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

describe('participants admin (SPEC §11, F12, §5.1)', () => {
  it('T-ADM-03: add a walk-in with "check in now" → source walk_in, accepted, live manual door scan', async () => {
    const email = ` Walk.In+${f.slug}@Example.test `;
    const res = await c.call('addWalkIn', org, { slug: f.slug }, { body: { firstName: 'Walk', lastName: 'In', email, checkInNow: true, sendPass: false } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'CREATED', scan: { code: 'ACCEPTED' } });
    const id = String(obj(res.body).participantId);
    const { rows } = await f.pool.query<{ source: string; status: string; email: string; search_text: string }>(
      'select source, status, email, search_text from participants where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ source: 'walk_in', status: 'accepted', email: `walk.in+${f.slug}@example.test`, search_text: 'walk in' });
    const { rows: scans } = await f.pool.query('select method from scans where participant_id = $1 and checkpoint_id = $2 and voided_at is null', [id, f.cp.D]);
    expect(scans).toEqual([{ method: 'manual' }]);
    const dup = await c.call('addWalkIn', org, { slug: f.slug }, { body: { firstName: 'X', lastName: '', email, checkInNow: false, sendPass: false } });
    expect(dup.status).toBe(409);
  });

  it('F12: walk-in with "send pass" queues exactly one pass email', async () => {
    const res = await c.call('addWalkIn', org, { slug: f.slug }, {
      body: { firstName: 'Mail', lastName: 'Me', email: `mail.me+${f.slug}@example.test`, checkInNow: false, sendPass: true },
    });
    const id = String(obj(res.body).participantId);
    const { rows } = await f.pool.query('select kind, status from email_outbox where participant_id = $1', [id]);
    expect(rows).toEqual([{ kind: 'pass_issued', status: 'pending' }]);
    expect(c.scheduled.length).toBeGreaterThan(0);
  });

  it('T-ADM-05: delete → tombstone per §5.1; counts unchanged; old token → REVOKED (deleted); no PII in audit', async () => {
    await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.B });
    const before = await f.pool.query<{ n: number }>('select count(*)::int as n from scans where event_id = $1 and voided_at is null', [f.e1.id]);
    const res = await c.call('deleteParticipant', org, { slug: f.slug, id: f.p.B }, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const { rows } = await f.pool.query(
      `select first_name, last_name, email, search_text, dietary_notes, linkedin_url, photo_path, deleted_at is not null as deleted
         from participants where id = $1`,
      [f.p.B],
    );
    expect(rows[0]).toEqual({
      first_name: 'Deleted', last_name: '', email: `deleted+${f.p.B}@invalid`, search_text: '',
      dietary_notes: null, linkedin_url: null, photo_path: null, deleted: true,
    });
    const after = await f.pool.query<{ n: number }>('select count(*)::int as n from scans where event_id = $1 and voided_at is null', [f.e1.id]);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    expect(await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.B })).toMatchObject({ code: 'REVOKED', revokeReason: 'deleted' });
    const { rows: audit } = await f.pool.query<{ detail: unknown }>(`select detail from audit_log where action = 'participant.delete' and subject_id = $1`, [f.p.B]);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.detail)).not.toMatch(/Ben|@/);
    expect((await c.call('deleteParticipant', org, { slug: f.slug, id: f.p.B }, { method: 'DELETE' })).body).toMatchObject({ code: 'ALREADY_DELETED' });
  });

  it('T-MAIL-11 (route): resend queues pass_reissued, rotating the pass; a second resend while in flight is not queued twice', async () => {
    const first = await c.call('resendPass', org, { slug: f.slug, id: f.p.N }, { method: 'POST' });
    expect(first.body).toEqual({ code: 'QUEUED' });
    expect((await c.call('resendPass', org, { slug: f.slug, id: f.p.N }, { method: 'POST' })).body).toEqual({ code: 'IN_FLIGHT' });
    await c.drain();
    const { rows } = await f.pool.query<{ email: string }>('select email from participants where id = $1', [f.p.N]);
    const fresh = tokenFromEmail(onlyEmailTo(c.mail.sent, rows[0]?.email ?? ''));
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.N })).code).toBe('REVOKED');
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: fresh })).code).not.toBe('REVOKED');
    expect((await c.call('resendPass', org, { slug: f.slug, id: f.p.C }, { method: 'POST' })).body).toEqual({ code: 'NOT_ACCEPTED' });
  });

  it('§11: revoke (manual) cancels the active pass; mark test flags the participant', async () => {
    expect((await c.call('revokePass', org, { slug: f.slug, id: f.p.Rv }, { method: 'POST' })).body).toEqual({ code: 'REVOKED' });
    expect(await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: f.token.Rv })).toMatchObject({ code: 'REVOKED', revokeReason: 'manual' });
    expect((await c.call('markTest', org, { slug: f.slug, id: f.p.N }, { body: { isTest: true } })).status).toBe(200);
    const { rows } = await f.pool.query<{ is_test: boolean }>('select is_test from participants where id = $1', [f.p.N]);
    expect(rows[0]?.is_test).toBe(true);
  });

  it('§11: list filters by status and no-shows; detail includes scan history with voided scans', async () => {
    const waitlisted = await c.call('listParticipants', org, { slug: f.slug }, { query: { status: 'waitlisted' } });
    expect((obj(waitlisted.body).participants as Array<{ id: string }>).map((p) => p.id)).toEqual([f.p.C]);
    const scan = await f.scan({ cp: f.cp.R, staff: f.staff.vol1, token: f.token.T });
    await f.voidScan(scan.scanId ?? '', f.staff.org1);
    const detail = await c.call('getParticipant', org, { slug: f.slug, id: f.p.T });
    expect(obj(detail.body).participant).toMatchObject({ id: f.p.T, firstName: 'Tess', isTest: true });
    expect(obj(detail.body).scans).toEqual([expect.objectContaining({ checkpointName: 'Raffle', voided: true, voidReason: 'Test scan' })]);
    const noShows = await c.call('listParticipants', org, { slug: f.slug }, { query: { noShow: '1' } });
    const ids = (obj(noShows.body).participants as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(f.p.A);
    expect(ids).not.toContain(f.p.C);
  });

  it('I-5: a participant of another event is invisible and untouchable through this event (404)', async () => {
    expect((await c.call('getParticipant', org, { slug: f.slug, id: f.p.X })).status).toBe(404);
    expect((await c.call('deleteParticipant', org, { slug: f.slug, id: f.p.X }, { method: 'DELETE' })).status).toBe(404);
    expect((await c.call('resendPass', org, { slug: f.slug, id: f.p.X }, { method: 'POST' })).status).toBe(404);
    const { rows } = await f.pool.query('select 1 from participants where id = $1 and deleted_at is null', [f.p.X]);
    expect(rows).toHaveLength(1);
  });
});

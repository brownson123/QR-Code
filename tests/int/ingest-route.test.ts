import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestClient, sheetRow } from '../fixtures/ingest';
import { onlyEmailTo, tokenFromEmail } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
let c: ReturnType<typeof ingestClient>;
beforeEach(async () => {
  f = await createStandardFixture({ poolSize: 8 });
  c = ingestClient();
});
afterEach(async () => {
  await f.close();
});

async function participant(externalId: string, eventId = f.e1.id) {
  const { rows } = await f.pool.query<{ id: string; email: string; status: string; first_name: string; linkedin_url: string | null }>(
    'select id, email, status, first_name, linkedin_url from participants where event_id = $1 and external_id = $2',
    [eventId, externalId],
  );
  return rows[0];
}

async function outbox(participantId: string) {
  const { rows } = await f.pool.query<{ kind: string; status: string }>(
    'select kind, status from email_outbox where participant_id = $1 order by created_at',
    [participantId],
  );
  return rows;
}

async function passes(participantId: string) {
  const { rows } = await f.pool.query<{ active: number; revoked_status_change: number; total: number }>(
    `select count(*) filter (where revoked_at is null)::int as active,
            count(*) filter (where revoke_reason = 'status_change')::int as revoked_status_change,
            count(*)::int as total
       from passes where participant_id = $1`,
    [participantId],
  );
  return rows[0];
}

async function eventCounts(eventId: string) {
  const { rows } = await f.pool.query<{ participants: number; passes: number; outbox: number }>(
    `select (select count(*) from participants where event_id = $1)::int as participants,
            (select count(*) from passes p join participants pa on pa.id = p.participant_id where pa.event_id = $1)::int as passes,
            (select count(*) from email_outbox o join participants pa on pa.id = o.participant_id where pa.event_id = $1)::int as outbox`,
    [eventId],
  );
  return rows[0];
}

describe('POST /api/ingest/sheet (SPEC F3, §9.2)', () => {
  it('T-ING-01: valid signature and fresh timestamp → 200 with per-row results in request order', async () => {
    const rows = [sheetRow(f.slug, { status: 'Waitlisted' }), sheetRow(f.slug), sheetRow(f.slug, { status: '' })];
    const res = await c.post({ event_slug: f.slug, rows });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { external_id: rows[0]?.external_id, result: 'CREATED' },
        { external_id: rows[1]?.external_id, result: 'PASS_QUEUED' },
        { external_id: rows[2]?.external_id, result: 'CREATED' },
      ],
    });
  });

  it('T-ING-02: off-by-one signature, wrong secret, missing headers → 401 and zero DB writes', async () => {
    const body = { event_slug: f.slug, rows: [sheetRow(f.slug)] };
    const before = await eventCounts(f.e1.id);
    const raw = JSON.stringify(body);
    const good = await c.post(raw, { signature: undefined });
    expect(good.status).toBe(200); // sanity: the same body signed correctly works
    const afterGood = await eventCounts(f.e1.id);
    const again = { event_slug: f.slug, rows: [sheetRow(f.slug)] };
    const { signSheetBody } = await import('@/lib/domain/hmac');
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signSheetBody(JSON.stringify(again), ts, process.env.SHEET_INGEST_SECRET ?? '');
    const flipped = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a');
    expect((await c.post(again, { signature: flipped, ts: Number(ts) })).status).toBe(401);
    expect((await c.post(again, { secret: 'x'.repeat(40) })).status).toBe(401);
    expect((await c.post(again, { signature: null })).status).toBe(401);
    expect((await c.post(again, { timestamp: null })).status).toBe(401);
    expect(await eventCounts(f.e1.id)).toEqual(afterGood);
    expect(afterGood?.participants).toBe((before?.participants ?? 0) + 1);
  });

  it('T-ING-03: timestamp 301 s old or 301 s in the future → 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const body = { event_slug: f.slug, rows: [sheetRow(f.slug)] };
    expect((await c.post(body, { ts: now - 301 })).status).toBe(401);
    expect((await c.post(body, { ts: now + 301 })).status).toBe(401);
  });

  it('T-ING-04: the same signed request twice → every row UNCHANGED; no duplicate participants, passes or outbox', async () => {
    const body = { event_slug: f.slug, rows: [sheetRow(f.slug), sheetRow(f.slug, { status: 'Waitlisted' }), sheetRow(f.slug, { status: '' })] };
    const ts = Math.floor(Date.now() / 1000);
    const first = await c.post(body, { ts });
    expect(first.status).toBe(200);
    const mid = await eventCounts(f.e1.id);
    const second = await c.post(body, { ts });
    const results = ((await second.json()) as { results: Array<{ result: string }> }).results.map((r) => r.result);
    expect(results).toEqual(['UNCHANGED', 'UNCHANGED', 'UNCHANGED']);
    expect(await eventCounts(f.e1.id)).toEqual(mid);
  });

  it('T-ING-05: non-ASCII names signed over raw UTF-8 bytes verify and are stored byte-exact', async () => {
    const names = ['Zoë', '李雷', 'محمد'];
    const rows = names.map((n) => sheetRow(f.slug, { first_name: n }));
    expect(await c.ingest(f.slug, rows)).toEqual(['PASS_QUEUED', 'PASS_QUEUED', 'PASS_QUEUED']);
    for (const [i, r] of rows.entries()) expect((await participant(r.external_id))?.first_name).toBe(names[i]);
  });

  it('T-ING-06: a new Accepted row → accepted participant with exactly one pending outbox row', async () => {
    const r = sheetRow(f.slug);
    await c.ingest(f.slug, [r]);
    const p = await participant(r.external_id);
    expect(p?.status).toBe('accepted');
    expect(await outbox(p?.id ?? '')).toEqual([{ kind: 'pass_issued', status: 'pending' }]);
  });

  it('T-ING-07: new Waitlisted / Rejected / blank rows → that status and no outbox', async () => {
    const rows = [sheetRow(f.slug, { status: 'Waitlisted' }), sheetRow(f.slug, { status: 'Rejected' }), sheetRow(f.slug, { status: '' })];
    expect(await c.ingest(f.slug, rows)).toEqual(['CREATED', 'CREATED', 'CREATED']);
    const statuses = [];
    for (const r of rows) {
      const p = await participant(r.external_id);
      statuses.push(p?.status);
      expect(await outbox(p?.id ?? '')).toEqual([]);
    }
    expect(statuses).toEqual(['waitlisted', 'rejected', 'pending']);
  });

  it('T-ING-08: Waitlisted → Accepted is PASS_QUEUED', async () => {
    const r = sheetRow(f.slug, { status: 'Waitlisted' });
    await c.ingest(f.slug, [r]);
    expect(await c.ingest(f.slug, [{ ...r, status: 'Accepted' }])).toEqual(['PASS_QUEUED']);
  });

  it('T-ING-09: Accepted → Accepted with nothing changed is UNCHANGED; no new outbox row or pass', async () => {
    const r = sheetRow(f.slug);
    await c.ingest(f.slug, [r]);
    await c.drain();
    const p = await participant(r.external_id);
    const before = { outbox: await outbox(p?.id ?? ''), passes: await passes(p?.id ?? '') };
    expect(await c.ingest(f.slug, [r])).toEqual(['UNCHANGED']);
    expect({ outbox: await outbox(p?.id ?? ''), passes: await passes(p?.id ?? '') }).toEqual(before);
  });

  it('T-ING-10: Accepted → Withdrawn revokes the pass, cancels in-flight outbox, leaves scans alone', async () => {
    const r = sheetRow(f.slug);
    await c.ingest(f.slug, [r]);
    await c.drain();
    const p = await participant(r.external_id);
    const token = tokenFromEmail(onlyEmailTo(c.mail.sent, r.email));
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token })).code).toBe('ACCEPTED');
    await f.pool.query(`insert into email_outbox (participant_id, kind) values ($1, 'pass_reissued')`, [p?.id]);

    expect(await c.ingest(f.slug, [{ ...r, status: 'Withdrawn' }])).toEqual(['REVOKED']);
    expect((await participant(r.external_id))?.status).toBe('withdrawn');
    expect(await passes(p?.id ?? '')).toMatchObject({ active: 0, revoked_status_change: 1 });
    expect((await outbox(p?.id ?? '')).map((o) => o.status)).toEqual(['sent', 'cancelled']);
    const { rows } = await f.pool.query('select 1 from scans where participant_id = $1 and voided_at is null', [p?.id]);
    expect(rows).toHaveLength(1);
  });

  it('T-ING-11: Withdrawn → Accepted again queues a new pass; the old one stays revoked', async () => {
    const r = sheetRow(f.slug);
    await c.ingest(f.slug, [r]);
    await c.drain();
    const oldToken = tokenFromEmail(onlyEmailTo(c.mail.sent, r.email));
    await c.ingest(f.slug, [{ ...r, status: 'Withdrawn' }]);
    expect(await c.ingest(f.slug, [{ ...r, status: 'Accepted' }])).toEqual(['PASS_QUEUED']);
    await c.drain();
    const p = await participant(r.external_id);
    expect(await passes(p?.id ?? '')).toMatchObject({ active: 1, revoked_status_change: 1, total: 2 });
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token: oldToken })).code).toBe('REVOKED');
  });

  it('T-ING-12: email " Ade@Gmail.COM " is stored as ade@gmail.com', async () => {
    const r = sheetRow(f.slug, { email: ` Ade+${f.slug}@Gmail.COM ` });
    await c.ingest(f.slug, [r]);
    expect((await participant(r.external_id))?.email).toBe(`ade+${f.slug}@gmail.com`);
  });

  it('T-ING-13: same external_id, new email → email updated, pass_reissued queued, audit row without PII', async () => {
    const r = sheetRow(f.slug);
    await c.ingest(f.slug, [r]);
    await c.drain();
    const newEmail = `new-${r.email}`;
    expect(await c.ingest(f.slug, [{ ...r, email: newEmail }])).toEqual(['PASS_QUEUED']);
    const p = await participant(r.external_id);
    expect(p?.email).toBe(newEmail);
    expect((await outbox(p?.id ?? '')).at(-1)).toEqual({ kind: 'pass_reissued', status: 'pending' });
    const { rows } = await f.pool.query<{ detail: unknown; actor_kind: string }>(
      `select detail, actor_kind from audit_log where action = 'participant.email_change' and subject_id = $1`,
      [p?.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_kind).toBe('sheet_sync');
    expect(JSON.stringify(rows[0]?.detail)).not.toMatch(/@|Row|Person/);
  });

  it('T-ING-14: a new external_id reusing an email in the event → CONFLICT_DUPLICATE_EMAIL; batch continues', async () => {
    const a = sheetRow(f.slug);
    await c.ingest(f.slug, [a]);
    const dup = sheetRow(f.slug, { email: a.email.toUpperCase() });
    const other = sheetRow(f.slug, { status: 'Waitlisted' });
    expect(await c.ingest(f.slug, [dup, other])).toEqual(['CONFLICT_DUPLICATE_EMAIL', 'CREATED']);
    expect(await participant(dup.external_id)).toBeUndefined();
  });

  it('T-ING-15: the same email in E1 and E2 → two participants', async () => {
    const r = sheetRow(f.slug);
    await c.ingest(f.slug, [r]);
    await c.ingest(`${f.slug}-2`, [r]);
    expect(await participant(r.external_id, f.e1.id)).toBeDefined();
    expect(await participant(r.external_id, f.e2.id)).toBeDefined();
  });

  it('T-ING-16: missing email / first_name / external_id → INVALID:<field>; the batch continues', async () => {
    const rows = [
      sheetRow(f.slug, { email: '' }),
      sheetRow(f.slug, { first_name: '' }),
      sheetRow(f.slug, { external_id: '' }),
      sheetRow(f.slug, { status: 'Waitlisted' }),
    ];
    expect(await c.ingest(f.slug, rows)).toEqual(['INVALID:email', 'INVALID:first_name', 'INVALID:external_id', 'CREATED']);
  });

  it('T-ING-17: "ACCEPTED ", "accepted", "Accepted" all normalize; "Maybe" → INVALID:status', async () => {
    const rows = ['ACCEPTED ', 'accepted', 'Accepted', 'Maybe'].map((status) => sheetRow(f.slug, { status }));
    expect(await c.ingest(f.slug, rows)).toEqual(['PASS_QUEUED', 'PASS_QUEUED', 'PASS_QUEUED', 'INVALID:status']);
  });

  it('T-ING-18: Accepted → blank is IGNORED_CLEAR and the pass stays active', async () => {
    const r = sheetRow(f.slug);
    await c.ingest(f.slug, [r]);
    await c.drain();
    expect(await c.ingest(f.slug, [{ ...r, status: '' }])).toEqual(['IGNORED_CLEAR']);
    const p = await participant(r.external_id);
    expect(p?.status).toBe('accepted');
    expect((await passes(p?.id ?? ''))?.active).toBe(1);
  });

  it('T-ING-19: unknown event_slug → 404', async () => {
    expect((await c.post({ event_slug: 'no-such-event-xyz', rows: [] })).status).toBe(404);
  });

  it('T-ING-20: 500 accepted rows → < 10 s, 500 outbox rows, zero provider calls during the request', async () => {
    const rows = Array.from({ length: 500 }, () => sheetRow(f.slug));
    const started = performance.now();
    const results = await c.ingest(f.slug, rows);
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(results.filter((r) => r === 'PASS_QUEUED')).toHaveLength(500);
    expect((await eventCounts(f.e1.id))?.outbox).toBe(500);
    expect(c.mail.sent).toHaveLength(0);
    expect(c.scheduled).toHaveLength(1);
    // Hygiene: don't leave 500 due rows for the next test file's drains.
    await f.pool.query(
      `update email_outbox set status = 'cancelled' where status = 'pending'
          and participant_id in (select id from participants where event_id = $1)`,
      [f.e1.id],
    );
  });

  it('T-ING-21: 501 rows → 400; body over 1 MB → 413', async () => {
    const rows = Array.from({ length: 501 }, () => sheetRow(f.slug, { status: 'Waitlisted' }));
    expect((await c.post({ event_slug: f.slug, rows })).status).toBe(400);
    const big = { event_slug: f.slug, rows: [sheetRow(f.slug, { dietary_notes: 'x'.repeat(1024 * 1024) })] };
    expect((await c.post(big)).status).toBe(413);
    expect((await c.post({ event_slug: f.slug, rows: [] }, { contentLength: String(2 * 1024 * 1024) })).status).toBe(413);
    expect(await eventCounts(f.e1.id)).toMatchObject({ outbox: 0 });
  });

  it('T-ING-21: malformed JSON and unknown keys → 400', async () => {
    expect((await c.post('{not json')).status).toBe(400);
    expect((await c.post({ event_slug: f.slug, rows: [], extra: 1 })).status).toBe(400);
    expect((await c.post({ event_slug: f.slug, rows: [{ ...sheetRow(f.slug), row_number: '3' }] })).status).toBe(400);
  });

  it('T-ING-22: O\'Brien, <script>, 100-char names stored; 101-char → INVALID:first_name', async () => {
    const rows = [
      sheetRow(f.slug, { first_name: "O'Brien" }),
      sheetRow(f.slug, { first_name: '<script>alert(1)</script>' }),
      sheetRow(f.slug, { first_name: 'n'.repeat(100) }),
      sheetRow(f.slug, { first_name: 'n'.repeat(101) }),
    ];
    expect(await c.ingest(f.slug, rows)).toEqual(['PASS_QUEUED', 'PASS_QUEUED', 'PASS_QUEUED', 'INVALID:first_name']);
    expect((await participant(rows[1]?.external_id ?? ''))?.first_name).toBe('<script>alert(1)</script>');
  });

  it('T-ING-23: invalid linkedin_url → row processed with linkedin_url null', async () => {
    const rows = [
      sheetRow(f.slug, { linkedin_url: 'linkedin.com/company/x' }),
      sheetRow(f.slug, { linkedin_url: 'javascript:alert(1)' }),
      sheetRow(f.slug, { linkedin_url: 'https://www.linkedin.com/in/ada-l' }),
    ];
    expect(await c.ingest(f.slug, rows)).toEqual(['PASS_QUEUED', 'PASS_QUEUED', 'PASS_QUEUED']);
    const urls = [];
    for (const r of rows) urls.push((await participant(r.external_id))?.linkedin_url);
    expect(urls).toEqual([null, null, 'https://www.linkedin.com/in/ada-l']);
  });

  it('T-ING-24: the same row posted 5× concurrently → 1 participant, 1 in-flight outbox row', async () => {
    const r = sheetRow(f.slug);
    const responses = await Promise.all(Array.from({ length: 5 }, () => c.post({ event_slug: f.slug, rows: [r] })));
    expect(responses.map((x) => x.status)).toEqual([200, 200, 200, 200, 200]);
    const results = await Promise.all(responses.map(async (x) => ((await x.json()) as { results: Array<{ result: string }> }).results[0]?.result));
    expect(results.filter((x) => x === 'PASS_QUEUED')).toHaveLength(1);
    const { rows } = await f.pool.query<{ n: number; inflight: number }>(
      `select count(distinct p.id)::int as n,
              count(o.id) filter (where o.status in ('pending', 'sending'))::int as inflight
         from participants p left join email_outbox o on o.participant_id = p.id
        where p.event_id = $1 and p.external_id = $2`,
      [f.e1.id, r.external_id],
    );
    expect(rows[0]).toEqual({ n: 1, inflight: 1 });
  });

  it('F3: a row for a deleted (tombstoned) participant is ignored: UNCHANGED, no writes', async () => {
    const r = sheetRow(f.slug);
    await c.ingest(f.slug, [r]);
    const p = await participant(r.external_id);
    await f.pool.query(
      `update participants set deleted_at = now(), first_name = 'Deleted', last_name = '', email = 'deleted+' || id || '@invalid',
              search_text = '' where id = $1`,
      [p?.id],
    );
    expect(await c.ingest(f.slug, [{ ...r, status: 'Waitlisted' }])).toEqual(['UNCHANGED']);
    expect((await participant(r.external_id))?.first_name).toBe('Deleted');
  });
});

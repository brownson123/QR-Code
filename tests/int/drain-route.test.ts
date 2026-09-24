import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/email/drain/route';
import { requireEnv } from '../fixtures/db';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

const call = (authorization?: string) =>
  POST(new Request('http://localhost/api/email/drain', { method: 'POST', headers: authorization ? { authorization } : {} }));

describe('POST /api/email/drain (SPEC §9.3)', () => {
  it('F4: missing or wrong bearer → 401 and nothing is claimed; DRAIN_SECRET → 200 and the row is sent', async () => {
    const person = await f.addParticipant(f.e1.id, { withPass: false });
    const { rows } = await f.pool.query<{ id: string }>(
      `insert into email_outbox (participant_id, kind) values ($1, 'pass_issued') returning id`,
      [person.id],
    );
    const id = rows[0]?.id;
    const status = async () =>
      (await f.pool.query<{ status: string }>('select status from email_outbox where id = $1', [id])).rows[0]?.status;

    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
    expect((await call(requireEnv('DRAIN_SECRET'))).status).toBe(401); // scheme required
    expect(await status()).toBe('pending');

    const ok = await call(`Bearer ${requireEnv('DRAIN_SECRET')}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ claimed: expect.any(Number), sent: expect.any(Number) });
    expect(await status()).toBe('sent');
  });
});

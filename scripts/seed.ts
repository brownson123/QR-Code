// `pnpm seed`: a demo event with 50 fake accepted participants and their QR PNGs in ./.seed/.
// Local Supabase only. Uses supabase-js directly (no server-only modules) so it runs under tsx.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { normalizeEmail, toSearchText } from '@/lib/domain/normalize';
import { generateToken, sha256hex } from '@/lib/domain/token';
import { renderQrPng } from '@/lib/qr/render';

const SLUG = 'demo';
const FIRST = ['Ada', 'Zoë', 'Liam', 'Priya', 'Mateo', 'Aisha', 'Kenji', 'Sofía', 'Noah', 'Chloé'];
const LAST = ["O'Brien", 'Nguyen', 'Okafor', 'Smith', 'García', 'Kowalski', 'Haddad', 'Li', 'Martin', 'Adebayo'];

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (expected in .env.local)`);
  return v;
}

async function main() {
  const url = need('NEXT_PUBLIC_SUPABASE_URL');
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('seed only runs against local Supabase');
  const origin = need('NEXT_PUBLIC_APP_ORIGIN');
  const db = createClient<Database>(url, need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  const existing = await db.from('events').select('id').eq('slug', SLUG).maybeSingle();
  if (existing.data) {
    console.log(`Event "${SLUG}" already exists. Run \`pnpm db:reset\` to start over.`);
    return;
  }

  const startsAt = new Date(Date.now() + 24 * 3600 * 1000);
  const event = await db
    .from('events')
    .insert({
      slug: SLUG,
      name: 'Demo Hack Day',
      venue: 'Demo Hall',
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 10 * 3600 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (event.error) throw event.error;
  const eventId = event.data.id;

  const cps = await db.from('checkpoints').insert([
    { event_id: eventId, name: 'Door', kind: 'door', requires_checkin: false, is_open: true, sort_order: 0 },
    { event_id: eventId, name: 'Lunch', kind: 'meal', is_open: true, sort_order: 1 },
    { event_id: eventId, name: 'Workshop', kind: 'session', capacity: 20, is_open: true, sort_order: 2 },
    { event_id: eventId, name: 'Raffle', kind: 'custom', requires_checkin: false, is_open: true, sort_order: 3 },
  ], { defaultToNull: false });
  if (cps.error) throw cps.error;

  // Dev staff: sign in at /login with these addresses; the links land in Mailpit (http://127.0.0.1:54324).
  const invites = await db.from('staff_invites').insert([
    { event_id: eventId, email: normalizeEmail('organizer@example.test'), role: 'organizer' },
    { event_id: eventId, email: normalizeEmail('volunteer@example.test'), role: 'volunteer' },
  ]);
  if (invites.error) throw invites.error;

  const dir = join(process.cwd(), '.seed');
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < 50; i++) {
    const first = FIRST[i % FIRST.length] ?? 'Demo';
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length] ?? 'Person';
    const n = String(i + 1).padStart(2, '0');
    const p = await db
      .from('participants')
      .insert({
        event_id: eventId,
        external_id: `seed-${n}`,
        email: normalizeEmail(`demo${n}@example.test`),
        first_name: first,
        last_name: last,
        search_text: toSearchText(`${first} ${last}`),
        dietary_notes: i % 7 === 0 ? 'Vegetarian' : null,
        status: 'accepted',
        source: 'seed',
      })
      .select('id')
      .single();
    if (p.error) throw p.error;
    const token = generateToken();
    const pass = await db.rpc('issue_pass', { p_participant_id: p.data.id, p_token_hash: sha256hex(token) });
    if (pass.error) throw pass.error;
    await writeFile(join(dir, `${SLUG}-${n}.png`), await renderQrPng(`${origin}/p#${token}`));
  }
  console.log(`Seeded event "${SLUG}" with 4 checkpoints and 50 participants. QR codes: .seed/${SLUG}-01..50.png`);
  console.log('Staff invites: organizer@example.test, volunteer@example.test (sign-in links arrive in Mailpit at http://127.0.0.1:54324).');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

// T-SEC-03: after `next build`, no server secret may appear anywhere in the client bundle.
// Searches for the literal name SERVICE_ROLE and for the FULL value of every server-only secret
// (a prefix is not enough: the service key's JWT header equals the anon key's).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STATIC = join(process.cwd(), '.next', 'static');
const SERVER_SECRETS = ['SUPABASE_SERVICE_ROLE_KEY', 'SHEET_INGEST_SECRET', 'DRAIN_SECRET', 'RESEND_API_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON'];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

let all;
try {
  all = files(STATIC);
} catch {
  console.error('T-SEC-03: .next/static not found. Run `next build` first.');
  process.exit(1);
}

const needles = [{ label: 'the string SERVICE_ROLE', value: 'SERVICE_ROLE' }];
for (const name of SERVER_SECRETS) {
  const value = process.env[name];
  if (value && value.length >= 16) needles.push({ label: `the value of ${name}`, value });
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('T-SEC-03: SUPABASE_SERVICE_ROLE_KEY is not set, so its value cannot be searched for.');
  process.exit(1);
}

const hits = [];
let anonSeen = false;
for (const file of all) {
  const text = readFileSync(file, 'utf8');
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && text.includes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) anonSeen = true;
  for (const n of needles) if (text.includes(n.value)) hits.push(`${n.label} in ${file.slice(process.cwd().length + 1)}`);
}

// Sanity check that we searched the real bundle: the public anon key IS inlined in client code.
if (!anonSeen) {
  console.error('T-SEC-03: the anon key was not found in the bundle either; the search is not looking at the right files.');
  process.exit(1);
}
if (hits.length > 0) {
  console.error(`T-SEC-03 FAILED:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`T-SEC-03 ok: ${all.length} files, ${needles.length} needles, no server secret in .next/static`);

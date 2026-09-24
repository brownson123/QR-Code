import { bearerMatches } from '@/lib/auth/secret';
import { db } from '@/lib/db/server';
import { env } from '@/lib/env';
import { route } from '@/lib/http/route';
import { runRetention } from '@/lib/privacy/retention';

// SPEC §15 retention, run daily by the same scheduler as the outbox drain (Bearer DRAIN_SECRET).
export const POST = route(async (request) => {
  if (!bearerMatches(request.headers.get('authorization'), env().DRAIN_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return Response.json(await runRetention(db(), new Date()));
});

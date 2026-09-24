import { bearerMatches } from '@/lib/auth/secret';
import { db } from '@/lib/db/server';
import { drainOutbox } from '@/lib/email/drain';
import { emailFrom, getProvider } from '@/lib/email';
import { env } from '@/lib/env';
import { route } from '@/lib/http/route';

// SPEC §9.3 / F4 (c). Bearer DRAIN_SECRET for the scheduler. The organizer-session path arrives in S5.
export const POST = route(async (request) => {
  if (!bearerMatches(request.headers.get('authorization'), env().DRAIN_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await drainOutbox({
    db: db(),
    provider: getProvider(),
    appOrigin: env().NEXT_PUBLIC_APP_ORIGIN,
    from: emailFrom(),
  });
  return Response.json(result);
});

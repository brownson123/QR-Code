import { db } from '@/lib/db/server';
import { route } from '@/lib/http/route';
import { createPassHandler } from '@/lib/pass/handlers';

// SPEC §9.3: authenticated by the token in the body; 30 requests/min per IP.
export const POST = route((request) => createPassHandler({ db: db() })(request));

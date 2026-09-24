import { cookieAuthenticator } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { route } from '@/lib/http/route';
import { createSearchHandler } from '@/lib/scan/handlers';

export const GET = route(async (request, ctx: { params: Promise<{ slug: string }> }) =>
  createSearchHandler({ db: db(), authenticate: cookieAuthenticator })(request, await ctx.params),
);

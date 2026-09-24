import { cookieAuthenticator } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { route } from '@/lib/http/route';
import { createVoidHandler } from '@/lib/scan/handlers';

export const POST = route(async (request, ctx: { params: Promise<{ id: string }> }) =>
  createVoidHandler({ db: db(), authenticate: cookieAuthenticator })(request, await ctx.params),
);

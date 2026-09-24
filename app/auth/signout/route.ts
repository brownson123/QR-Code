import { NextResponse } from 'next/server';
import { supabaseForRequest } from '@/lib/auth/session';
import { route } from '@/lib/http/route';

export const POST = route(async (request) => {
  await (await supabaseForRequest()).auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
});

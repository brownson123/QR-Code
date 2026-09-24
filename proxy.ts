import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Next.js 16 "proxy" (formerly middleware). Refreshes the Supabase session cookie on staff pages and
// sends signed-out visitors to /login with a way back. Authorization is NOT done here: every route
// handler checks the session and requireStaff() itself.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ['/scan/:path*', '/admin/:path*'],
};

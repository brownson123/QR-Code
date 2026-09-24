import { createClient } from '@supabase/supabase-js';
import type { Authenticate } from '@/lib/auth/session';
import { requireEnv } from './db';
import { STAFF_PASSWORD } from './standard';

function anon() {
  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Real sign-in: returns an access token issued by the local auth server.
export async function signInAs(email: string): Promise<string> {
  const { data, error } = await anon().auth.signInWithPassword({ email, password: STAFF_PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message ?? 'no session'}`);
  return data.session.access_token;
}

// Test authenticator: the JWT travels as a bearer header instead of a cookie, but is still verified
// by the auth server (nothing is mocked). Production uses the cookie authenticator.
export const bearerAuth: Authenticate = async (request) => {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const { data } = await anon().auth.getUser(header.slice('Bearer '.length));
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
};

export const asBearer = (jwt: string | null): Record<string, string> => (jwt ? { authorization: `Bearer ${jwt}` } : {});

// A real @supabase/ssr session cookie, produced by the library's own setAll during a password
// sign-in. Lets tests call the production route files (cookie authenticator) as a given staff member.
export async function sessionCookieFor(email: string): Promise<string> {
  const { createServerClient } = await import('@supabase/ssr');
  const jar = new Map<string, string>();
  const supabase = createServerClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => {
        for (const c of toSet) jar.set(c.name, c.value);
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password: STAFF_PASSWORD });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
}

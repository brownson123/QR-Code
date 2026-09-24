import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Database } from './types.gen';

export type Db = SupabaseClient<Database>;

let client: Db | undefined;

// Service-role client. Bypasses RLS, so callers MUST authorize before the first query (I-5).
export function db(): Db {
  client ??= createClient<Database>(env().NEXT_PUBLIC_SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

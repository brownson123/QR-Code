import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { normalizeEmail } from '@/lib/domain/normalize';

// SPEC F9 step 3: on sign-in, turn every invite for the verified email into event_staff rows.
export async function consumeInvites(db: SupabaseClient<Database>, user: { id: string; email: string | null }): Promise<number> {
  if (!user.email) return 0;
  const { data, error } = await db.rpc('consume_staff_invites', { p_user_id: user.id, p_email: normalizeEmail(user.email) });
  if (error) throw new Error(`consume_staff_invites failed (${error.code})`);
  return data;
}

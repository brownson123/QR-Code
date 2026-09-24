import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';

type Db = SupabaseClient<Database>;
export type StaffRole = Database['public']['Enums']['staff_role'];

// SPEC §3 / I-5. One query resolves the slug AND checks membership, so nothing about an event is
// read for a non-member, and "no such event" looks the same as "not your event". Never cached
// (F9: removal takes effect on the very next request).
export async function requireStaffBySlug(
  db: Db,
  userId: string,
  slug: string,
  role?: StaffRole,
): Promise<{ eventId: string; role: StaffRole } | null> {
  const { data, error } = await db
    .from('event_staff')
    .select('role, event_id, events!inner(slug)')
    .eq('user_id', userId)
    .eq('events.slug', slug)
    .maybeSingle();
  if (error) throw new Error(`staff lookup failed (${error.code})`);
  if (!data || (role && data.role !== role)) return null;
  return { eventId: data.event_id, role: data.role };
}

export async function isOrganizerOfAnyEvent(db: Db, userId: string): Promise<boolean> {
  const { count, error } = await db
    .from('event_staff')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'organizer');
  if (error) throw new Error(`staff lookup failed (${error.code})`);
  return (count ?? 0) > 0;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { PHOTO_BUCKET } from '@/lib/storage/photos';

type Db = SupabaseClient<Database>;
export const RETENTION_DAYS = 30;

export interface RetentionReport {
  events: Array<{ eventId: string; participants: number; photos: number }>;
}

// SPEC §15: 30 days after an event ends, delete its photos (storage objects too) and dietary notes.
// Storage first, then the rows, so a crash in between is repaired by the next run (removing a
// missing object is not an error). Idempotent: already-cleared rows are not selected again.
export async function runRetention(db: Db, now: Date): Promise<RetentionReport> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  const { data: events, error } = await db.from('events').select('id').lte('ends_at', cutoff);
  if (error) throw new Error(`retention events load failed (${error.code})`);

  const report: RetentionReport = { events: [] };
  for (const { id: eventId } of events) {
    const { data: people, error: peopleError } = await db
      .from('participants')
      .select('id, photo_path')
      .eq('event_id', eventId)
      .or('photo_path.not.is.null,dietary_notes.not.is.null');
    if (peopleError) throw new Error(`retention participants load failed (${peopleError.code})`);
    if (people.length === 0) continue;

    const paths = people.flatMap((p) => (p.photo_path ? [p.photo_path] : []));
    for (let i = 0; i < paths.length; i += 500) {
      const { error: removeError } = await db.storage.from(PHOTO_BUCKET).remove(paths.slice(i, i + 500));
      if (removeError) throw new Error(`retention photo removal failed (${removeError.name})`);
    }
    const ids = people.map((p) => p.id);
    for (let i = 0; i < ids.length; i += 500) {
      const { error: updateError } = await db
        .from('participants')
        .update({ photo_path: null, photo_updated_at: null, dietary_notes: null, updated_at: now.toISOString() })
        .in('id', ids.slice(i, i + 500));
      if (updateError) throw new Error(`retention update failed (${updateError.code})`);
    }
    // Counts only (I-11).
    const { error: auditError } = await db
      .from('audit_log')
      .insert({ event_id: eventId, actor_kind: 'system', action: 'privacy.retention', detail: { participants: ids.length, photos: paths.length } });
    if (auditError) throw new Error(`audit_log insert failed (${auditError.code})`);
    report.events.push({ eventId, participants: ids.length, photos: paths.length });
  }
  return report;
}

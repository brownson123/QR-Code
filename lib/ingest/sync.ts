import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { mapSheetValues, SHEET_TAB } from '@/lib/domain/sheet';
import { parseServiceAccount, readSheetValues } from '@/lib/sheets/google';
import { ingestRows, type RowResult } from './rows';

// SPEC F10 "Sync now": read the whole Sheet and run the SAME upsert as F3, dry run first.

export interface SyncReport {
  dryRun: boolean;
  total: number;
  counts: Record<string, number>;
  /** Rows that would change (or did): external id + result only. */
  changes: RowResult[];
}

export async function syncSheet(
  db: SupabaseClient<Database>,
  eventId: string,
  opts: { dryRun: boolean; readSheet: () => Promise<string[][]>; actorUserId?: string },
): Promise<SyncReport> {
  const rows = mapSheetValues(await opts.readSheet());
  const results = await ingestRows(db, eventId, rows, { dryRun: opts.dryRun });
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.result] = (counts[r.result] ?? 0) + 1;
  const report: SyncReport = {
    dryRun: opts.dryRun,
    total: results.length,
    counts,
    changes: results.filter((r) => r.result !== 'UNCHANGED' && r.result !== 'IGNORED_CLEAR'),
  };
  if (!opts.dryRun) {
    // Counts only (I-11).
    const { error } = await db.from('audit_log').insert({
      event_id: eventId,
      actor_user_id: opts.actorUserId ?? null,
      actor_kind: opts.actorUserId ? 'staff' : 'system',
      action: 'sheet.sync',
      detail: { total: report.total, counts },
    });
    if (error) throw new Error(`audit_log insert failed (${error.code})`);
  }
  return report;
}

export function googleSheetReader(sheetId: string, serviceAccountJson: string): () => Promise<string[][]> {
  const serviceAccount = parseServiceAccount(serviceAccountJson);
  return () => readSheetValues({ sheetId, tab: SHEET_TAB, serviceAccount });
}

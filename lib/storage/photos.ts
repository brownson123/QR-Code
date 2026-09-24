import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';

// SPEC F5: photos live in a private bucket; staff and the pass holder only ever get signed URLs.
export const PHOTO_BUCKET = 'photos';
export const PHOTO_URL_TTL_SECONDS = 300;

export function photoPath(eventId: string, participantId: string): string {
  return `${eventId}/${participantId}.jpg`;
}

export async function signedPhotoUrl(
  db: SupabaseClient<Database>,
  path: string,
  ttlSeconds: number = PHOTO_URL_TTL_SECONDS,
): Promise<string> {
  const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error) throw new Error(`photo signing failed (${error.name})`);
  return data.signedUrl;
}

// Batch form for lists (manual search): one request for up to 10 photos.
export async function signedPhotoUrls(db: SupabaseClient<Database>, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
  if (error) throw new Error(`photo signing failed (${error.name})`);
  for (const item of data) if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
  return out;
}

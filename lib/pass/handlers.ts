import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { z } from 'zod';
import type { Database } from '@/lib/db/types.gen';
import { sniffImage } from '@/lib/domain/image';
import { passState, type PassLookup } from '@/lib/domain/pass-state';
import { sha256hex } from '@/lib/domain/token';
import { PHOTO_BUCKET, photoPath, signedPhotoUrl } from '@/lib/storage/photos';

type Db = SupabaseClient<Database>;

const MB = 1024 * 1024;
export const MAX_PHOTO_BYTES = 8 * MB;
const MAX_PHOTO_REQUEST_BYTES = MAX_PHOTO_BYTES + 64 * 1024; // multipart overhead
const MAX_INPUT_PIXELS = 60_000_000; // generous for 48 MP phones; stops decompression bombs

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

const lookupSchema = z.object({
  pass: z.object({ id: z.string(), revokedAt: z.string().nullable(), revokeReason: z.string().nullable() }),
  participant: z.object({
    id: z.string(),
    eventId: z.string(),
    firstName: z.string(),
    status: z.string(),
    deleted: z.boolean(),
    photoPath: z.string().nullable(),
    photoUpdatedAt: z.string().nullable(),
  }),
  event: z.object({ name: z.string(), venue: z.string(), startsAt: z.string(), timezone: z.string() }),
  checkedIn: z.boolean(),
});

// Any string is hashed and looked up, so malformed and unknown tokens take the same path (T-PASS-02).
async function lookupToken(db: Db, token: string): Promise<PassLookup | null> {
  const { data, error } = await db.rpc('pass_lookup', { p_token_hash: sha256hex(token) });
  if (error) throw new Error(`pass_lookup failed (${error.code})`);
  return data === null ? null : lookupSchema.parse(data);
}

async function withinLimit(db: Db, key: string, windowSeconds: number, limit: number): Promise<boolean> {
  const { data, error } = await db.rpc('rate_limit_hit', { p_key: key, p_window_seconds: windowSeconds, p_limit: limit });
  if (error) throw new Error(`rate_limit_hit failed (${error.code})`);
  return data;
}

// The IP is only used hashed, so no raw address is stored (I-11).
function ipKey(request: Request): string {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return `pass:ip:${sha256hex(ip).slice(0, 32)}`;
}

const passBody = z.object({ token: z.string().max(512) }).strict();

// POST /api/pass (SPEC F5, §9.3): token in the body only, never in a URL (I-3).
export function createPassHandler(deps: { db: Db }) {
  return async (request: Request): Promise<Response> => {
    if (!(await withinLimit(deps.db, ipKey(request), 60, 30))) return json({ error: 'rate_limited' }, 429);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const body = passBody.safeParse(raw);
    if (!body.success) return json({ error: 'invalid_body' }, 400);

    const found = await lookupToken(deps.db, body.data.token);
    const state = passState(found);
    if (state === 'not_found' || !found) return json({ state: 'not_found' }, 404);
    if (state !== 'active') return json({ state });

    const { participant, event } = found;
    return json({
      state,
      firstName: participant.firstName,
      event,
      photo: {
        url: participant.photoPath ? await signedPhotoUrl(deps.db, participant.photoPath) : null,
        updatedAt: participant.photoUpdatedAt,
      },
      photoLocked: found.checkedIn,
    });
  };
}

// POST /api/pass/photo (SPEC F5): multipart { token, file }.
export function createPhotoHandler(deps: { db: Db }) {
  return async (request: Request): Promise<Response> => {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_PHOTO_REQUEST_BYTES) return json({ error: 'too_large' }, 413);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    const token = form.get('token');
    const file = form.get('file');
    if (typeof token !== 'string' || !(file instanceof File)) return json({ error: 'invalid_body' }, 400);

    const found = await lookupToken(deps.db, token);
    if (passState(found) !== 'active' || !found) return json({ error: 'not_found' }, 404);
    if (!(await withinLimit(deps.db, `photo:pass:${found.pass.id}`, 3600, 10))) return json({ error: 'rate_limited' }, 429);
    if (found.checkedIn) return json({ error: 'PHOTO_LOCKED' }, 409);
    if (file.size > MAX_PHOTO_BYTES) return json({ error: 'too_large' }, 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!sniffImage(bytes)) return json({ error: 'unsupported_type' }, 415);

    let output: Buffer;
    try {
      // .rotate() applies EXIF orientation BEFORE metadata is stripped (sharp strips by default).
      output = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(512, 512, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {
      return json({ error: 'unsupported_type' }, 415);
    }

    const path = photoPath(found.participant.eventId, found.participant.id);
    const upload = await deps.db.storage.from(PHOTO_BUCKET).upload(path, output, { contentType: 'image/jpeg', upsert: true });
    if (upload.error) throw new Error(`photo upload failed (${upload.error.name})`);
    const photoUpdatedAt = new Date().toISOString();
    const { error } = await deps.db
      .from('participants')
      .update({ photo_path: path, photo_updated_at: photoUpdatedAt })
      .eq('id', found.participant.id);
    if (error) throw new Error(`photo_path update failed (${error.code})`);
    return json({ ok: true, photoUpdatedAt });
  };
}

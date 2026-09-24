import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Authenticate } from '@/lib/auth/session';
import { requireStaffBySlug } from '@/lib/auth/staff';
import type { Database, Json } from '@/lib/db/types.gen';
import { toCsv } from '@/lib/domain/csv';
import { bucketLabel, doorClosedWarning } from '@/lib/domain/dashboard';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { normalizeEmail, toSearchText } from '@/lib/domain/normalize';
import { parseSheetId } from '@/lib/domain/sheet';
import { syncSheet } from '@/lib/ingest/sync';
import { PHOTO_BUCKET, signedPhotoUrl } from '@/lib/storage/photos';

type Db = SupabaseClient<Database>;
type Params = Record<string, string>;

export interface AdminDeps {
  db: Db;
  authenticate: Authenticate;
  /** Runs a task after the response (Next.js `after()` in production). */
  scheduleDrain: (task: () => Promise<unknown>) => void;
  drain: () => Promise<unknown>;
  now?: () => Date;
  /** Builds a reader for a linked Sheet, or null when Sync now isn't configured. */
  sheetReader?: (sheetId: string) => (() => Promise<string[][]>) | null;
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });
const badRequest = () => json({ error: 'invalid_request' }, 400);
const notFound = () => json({ error: 'not_found' }, 404);
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

const uuid = (v: string | undefined) => z.uuid().safeParse(v).data ?? null;

const metricsSchema = z.object({
  accepted: z.number(),
  checkedIn: z.number(),
  noShows: z.number(),
  checkpoints: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(['door', 'meal', 'session', 'custom']),
      isOpen: z.boolean(),
      capacity: z.number().nullable(),
      requiresCheckin: z.boolean(),
      sortOrder: z.number(),
      liveScans: z.number(),
    }),
  ),
  arrivals: z.array(z.object({ bucketUtc: z.string(), arrivals: z.number() })),
  outbox: z.object({ pending: z.number(), failed: z.number() }),
  notFound: z.array(z.object({ staffUserId: z.string(), displayName: z.string().nullable(), count: z.number() })),
  scanProblems: z.array(z.object({ checkpointId: z.string().nullable(), code: z.string(), count: z.number() })),
});

const checkpointCreate = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['door', 'meal', 'session', 'custom']),
    capacity: z.number().int().positive().nullable().optional(),
    requiresCheckin: z.boolean().optional(),
    isOpen: z.boolean().optional(),
    startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();
const checkpointUpdate = checkpointCreate.omit({ kind: true }).partial().strict();

const walkInBody = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().max(100).default(''),
    email: z.string().transform(normalizeEmail).pipe(z.email()),
    checkInNow: z.boolean().default(false),
    sendPass: z.boolean().default(false),
  })
  .strict();

const inviteBody = z.object({ email: z.string().transform(normalizeEmail).pipe(z.email()), role: z.enum(['organizer', 'volunteer']) }).strict();

type CheckpointRow = Database['public']['Tables']['checkpoints']['Row'];
const checkpointView = (c: CheckpointRow) => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  isOpen: c.is_open,
  requiresCheckin: c.requires_checkin,
  capacity: c.capacity,
  startsAt: c.starts_at,
  sortOrder: c.sort_order,
});

function csvResponse(slug: string, kind: string, body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-${kind}"`,
      ...NO_STORE,
    },
  });
}

// SPEC §11. Every handler first requires an organizer of the event named in the URL (I-5), and
// every query is scoped to that event's id, so ids from another event resolve to 404.
export function createAdminApi(deps: AdminDeps) {
  const { db } = deps;
  const now = () => (deps.now ?? (() => new Date()))();

  async function guard(request: Request, params: Params): Promise<{ userId: string; eventId: string } | Response> {
    const user = await deps.authenticate(request);
    if (!user) return json({ error: 'unauthorized' }, 401);
    const staff = await requireStaffBySlug(db, user.id, params.slug ?? '', 'organizer');
    if (!staff) return json({ error: 'forbidden' }, 403);
    return { userId: user.id, eventId: staff.eventId };
  }

  // audit_log.detail holds ids, kinds and flags only, never names, emails or tokens (I-11).
  async function audit(eventId: string, actor: string, action: string, subjectId: string | null, detail: { [key: string]: Json } = {}) {
    const { error } = await db
      .from('audit_log')
      .insert({ event_id: eventId, actor_user_id: actor, actor_kind: 'staff', action, subject_id: subjectId, detail });
    if (error) throw new Error(`audit_log insert failed (${error.code})`);
  }

  async function loadEvent(eventId: string) {
    const { data, error } = await db.from('events').select('name, venue, starts_at, ends_at, timezone, sheet_id').eq('id', eventId).single();
    if (error) throw new Error(`event load failed (${error.code})`);
    return data;
  }

  async function metrics(eventId: string) {
    const { data, error } = await db.rpc('event_metrics', { p_event_id: eventId, p_now: now().toISOString() });
    if (error) throw new Error(`event_metrics failed (${error.code})`);
    return metricsSchema.parse(data);
  }

  async function staffNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await db.from('staff_profiles').select('user_id, display_name').in('user_id', [...new Set(ids)]);
    if (error) throw new Error(`staff_profiles load failed (${error.code})`);
    return new Map(data.map((r) => [r.user_id, r.display_name]));
  }

  return {
    // GET /api/admin/[slug]/dashboard (§11, §13)
    async dashboard(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const [m, event] = await Promise.all([metrics(g.eventId), loadEvent(g.eventId)]);
      const checkpoints = m.checkpoints.map((c) => ({
        ...c,
        fill: c.capacity ? round4(c.liveScans / c.capacity) : null,
        ...(c.kind === 'meal' && { uptake: m.checkedIn ? round4(c.liveScans / m.checkedIn) : null }),
      }));
      const door = m.checkpoints.find((c) => c.kind === 'door');
      return json({
        event: { name: event.name, startsAt: event.starts_at, endsAt: event.ends_at, timezone: event.timezone },
        generatedAt: now().toISOString(),
        accepted: m.accepted,
        checkedIn: m.checkedIn,
        checkInRate: m.accepted ? round4(m.checkedIn / m.accepted) : 0,
        noShows: m.noShows,
        checkpoints,
        sessionRanking: m.checkpoints
          .filter((c) => c.kind === 'session')
          .map((c) => ({ id: c.id, name: c.name, liveScans: c.liveScans, capacity: c.capacity }))
          .sort((a, b) => b.liveScans - a.liveScans || a.name.localeCompare(b.name, 'en')),
        arrivals: m.arrivals.map((a) => {
          const bucketUtc = new Date(a.bucketUtc).toISOString();
          return { bucketUtc, label: bucketLabel(bucketUtc, event.timezone), arrivals: a.arrivals };
        }),
        outbox: m.outbox,
        alerts: {
          doorClosed: doorClosedWarning({ now: now(), startsAt: event.starts_at, endsAt: event.ends_at, doorOpen: door?.isOpen ?? false }),
          notFound: m.notFound,
        },
        scanProblems: m.scanProblems,
      });
    },

    // GET /api/admin/[slug]/checkpoints
    async listCheckpoints(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const { data, error } = await db.from('checkpoints').select('*').eq('event_id', g.eventId).order('sort_order').order('name');
      if (error) throw new Error(`checkpoints load failed (${error.code})`);
      return json({ checkpoints: data.map(checkpointView) });
    },

    // POST /api/admin/[slug]/checkpoints
    async createCheckpoint(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const body = checkpointCreate.safeParse(await readJson(request));
      if (!body.success) return badRequest();
      const b = body.data;
      const { data, error } = await db
        .from('checkpoints')
        .insert({
          event_id: g.eventId,
          name: b.name,
          kind: b.kind,
          // CLAUDE.md gotcha: the column defaults to true and a check constraint rejects a door with true.
          requires_checkin: b.kind === 'door' ? false : (b.requiresCheckin ?? true),
          capacity: b.capacity ?? null,
          is_open: b.isOpen ?? false,
          starts_at: b.startsAt ?? null,
          sort_order: b.sortOrder ?? 0,
        })
        .select('*')
        .single();
      if (error?.code === '23505') {
        return json({ error: error.message.includes('checkpoints_one_door') ? 'DOOR_EXISTS' : 'NAME_TAKEN' }, 409);
      }
      if (error) throw new Error(`checkpoint insert failed (${error.code})`);
      await audit(g.eventId, g.userId, 'checkpoint.create', data.id, { kind: data.kind });
      return json({ checkpoint: checkpointView(data) }, 201);
    },

    // PATCH /api/admin/[slug]/checkpoints/[id]
    async updateCheckpoint(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const id = uuid(params.id);
      const body = checkpointUpdate.safeParse(await readJson(request));
      if (!id) return notFound();
      if (!body.success) return badRequest();
      const b = body.data;
      const patch: Database['public']['Tables']['checkpoints']['Update'] = {
        ...(b.name !== undefined && { name: b.name }),
        ...(b.isOpen !== undefined && { is_open: b.isOpen }),
        ...(b.capacity !== undefined && { capacity: b.capacity }),
        ...(b.requiresCheckin !== undefined && { requires_checkin: b.requiresCheckin }),
        ...(b.startsAt !== undefined && { starts_at: b.startsAt }),
        ...(b.sortOrder !== undefined && { sort_order: b.sortOrder }),
      };
      const { data, error } = await db.from('checkpoints').update(patch).eq('id', id).eq('event_id', g.eventId).select('*').maybeSingle();
      if (error?.code === '23514') return badRequest(); // e.g. a door with requires_checkin
      if (error?.code === '23505') return json({ error: 'NAME_TAKEN' }, 409);
      if (error) throw new Error(`checkpoint update failed (${error.code})`);
      if (!data) return notFound();
      if (b.isOpen !== undefined) await audit(g.eventId, g.userId, b.isOpen ? 'checkpoint.open' : 'checkpoint.close', id);
      return json({ checkpoint: checkpointView(data) });
    },

    // DELETE /api/admin/[slug]/checkpoints/[id]  (T-ADM-04)
    async deleteCheckpoint(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const id = uuid(params.id);
      if (!id) return notFound();
      const { data, error } = await db.rpc('delete_checkpoint', { p_event_id: g.eventId, p_checkpoint_id: id, p_actor: g.userId });
      if (error) throw new Error(`delete_checkpoint failed (${error.code})`);
      if (data === 'NOT_FOUND') return notFound();
      if (data === 'HAS_SCANS') return json({ error: 'HAS_SCANS', message: 'This checkpoint has scans, so it can’t be deleted. Close it instead.' }, 409);
      return json({ code: data });
    },

    // GET /api/admin/[slug]/participants?status=&q=&noShow=1
    async listParticipants(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const url = new URL(request.url);
      const status = z.enum(['pending', 'accepted', 'waitlisted', 'rejected', 'withdrawn']).optional().safeParse(url.searchParams.get('status') || undefined);
      if (!status.success) return badRequest();
      const q = toSearchText(url.searchParams.get('q') ?? '');
      const { data, error } = await db.rpc('admin_participants', {
        p_event_id: g.eventId,
        ...(status.data && { p_status: status.data }),
        ...(q && { p_query: q }),
        p_no_show: url.searchParams.get('noShow') === '1',
      });
      if (error) throw new Error(`admin_participants failed (${error.code})`);
      return json({
        participants: data.map((p) => ({
          id: p.id,
          firstName: p.first_name,
          lastName: p.last_name,
          email: p.email,
          status: p.status,
          source: p.source,
          isTest: p.is_test,
          applicantId: p.external_id,
          dietaryNotes: p.dietary_notes,
          hasPhoto: p.photo_path !== null,
          photoUpdatedAt: p.photo_updated_at,
          passState: p.pass_state,
          liveScans: p.live_scans,
          checkedIn: p.checked_in,
        })),
      });
    },

    // GET /api/admin/[slug]/participants/[id]
    async getParticipant(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const id = uuid(params.id);
      if (!id) return notFound();
      const { data: p, error } = await db.from('participants').select('*').eq('id', id).eq('event_id', g.eventId).is('deleted_at', null).maybeSingle();
      if (error) throw new Error(`participant load failed (${error.code})`);
      if (!p) return notFound();
      const { data: scans, error: scanError } = await db
        .from('scans')
        .select('id, scanned_at, method, scanned_by, voided_at, void_reason, checkpoints(name, kind)')
        .eq('participant_id', id)
        .order('scanned_at');
      if (scanError) throw new Error(`scans load failed (${scanError.code})`);
      const names = await staffNames(scans.map((s) => s.scanned_by));
      return json({
        participant: {
          id: p.id,
          firstName: p.first_name,
          lastName: p.last_name,
          email: p.email,
          status: p.status,
          source: p.source,
          isTest: p.is_test,
          applicantId: p.external_id,
          dietaryNotes: p.dietary_notes,
          linkedinUrl: p.linkedin_url,
          photoUrl: p.photo_path ? await signedPhotoUrl(db, p.photo_path) : null,
          photoUpdatedAt: p.photo_updated_at,
        },
        scans: scans.map((s) => ({
          id: s.id,
          checkpointName: s.checkpoints.name,
          kind: s.checkpoints.kind,
          scannedAt: s.scanned_at,
          method: s.method,
          scannedByName: names.get(s.scanned_by) ?? null,
          voided: s.voided_at !== null,
          voidedAt: s.voided_at,
          voidReason: s.void_reason,
        })),
      });
    },

    // POST /api/admin/[slug]/participants  (F12 walk-in)
    async addWalkIn(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const body = walkInBody.safeParse(await readJson(request));
      if (!body.success) return badRequest();
      const b = body.data;
      const { data, error } = await db.rpc('add_walk_in', {
        p_event_id: g.eventId,
        p_organizer_id: g.userId,
        p_email: b.email,
        p_first_name: b.firstName,
        p_last_name: b.lastName,
        p_search_text: toSearchText(`${b.firstName} ${b.lastName}`),
        p_check_in: b.checkInNow,
        p_send_pass: b.sendPass,
      });
      if (error) throw new Error(`add_walk_in failed (${error.code})`);
      const result = z.object({ code: z.string(), participantId: z.string().optional(), scan: z.unknown().optional() }).parse(data);
      if (result.code !== 'CREATED') return json(result, 409);
      if (b.sendPass) deps.scheduleDrain(deps.drain);
      return json(result, 201);
    },

    // POST /api/admin/[slug]/participants/[id]/resend
    async resendPass(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const id = uuid(params.id);
      if (!id) return notFound();
      const { data, error } = await db.rpc('enqueue_pass', { p_event_id: g.eventId, p_participant_id: id, p_actor: g.userId });
      if (error) throw new Error(`enqueue_pass failed (${error.code})`);
      if (data === 'NOT_FOUND') return notFound();
      if (data === 'QUEUED') deps.scheduleDrain(deps.drain);
      return json({ code: data });
    },

    // POST /api/admin/[slug]/participants/[id]/revoke
    async revokePass(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const id = uuid(params.id);
      if (!id) return notFound();
      const { data, error } = await db.rpc('revoke_pass', { p_event_id: g.eventId, p_participant_id: id, p_actor: g.userId });
      if (error) throw new Error(`revoke_pass failed (${error.code})`);
      if (data === 'NOT_FOUND') return notFound();
      return json({ code: data });
    },

    // POST /api/admin/[slug]/participants/[id]/test  { isTest }
    async markTest(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const id = uuid(params.id);
      const body = z.object({ isTest: z.boolean() }).strict().safeParse(await readJson(request));
      if (!id) return notFound();
      if (!body.success) return badRequest();
      const { data, error } = await db
        .from('participants')
        .update({ is_test: body.data.isTest, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('event_id', g.eventId)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle();
      if (error) throw new Error(`mark test failed (${error.code})`);
      if (!data) return notFound();
      await audit(g.eventId, g.userId, 'participant.mark_test', id, { isTest: body.data.isTest });
      return json({ isTest: body.data.isTest });
    },

    // DELETE /api/admin/[slug]/participants/[id]  (§5.1 tombstone)
    async deleteParticipant(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const id = uuid(params.id);
      if (!id) return notFound();
      const { data, error } = await db.rpc('delete_participant', { p_event_id: g.eventId, p_participant_id: id, p_actor: g.userId });
      if (error) throw new Error(`delete_participant failed (${error.code})`);
      const result = z.object({ code: z.string(), photoPath: z.string().nullable().optional() }).parse(data);
      if (result.code === 'NOT_FOUND') return notFound();
      if (result.photoPath) {
        const { error: removeError } = await db.storage.from(PHOTO_BUCKET).remove([result.photoPath]);
        if (removeError) throw new Error(`photo removal failed (${removeError.name})`);
      }
      return json({ code: result.code });
    },

    // GET /api/admin/[slug]/staff
    async listStaff(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const [{ data: staff, error }, { data: invites, error: inviteError }] = await Promise.all([
        db.from('event_staff').select('user_id, role, added_at').eq('event_id', g.eventId).order('added_at'),
        db.from('staff_invites').select('email, role').eq('event_id', g.eventId).order('email'),
      ]);
      if (error || inviteError) throw new Error('staff load failed');
      const names = await staffNames(staff.map((s) => s.user_id));
      return json({
        staff: staff.map((s) => ({ userId: s.user_id, role: s.role, displayName: names.get(s.user_id) ?? null, addedAt: s.added_at, isMe: s.user_id === g.userId })),
        invites: invites.map((i) => ({ email: i.email, role: i.role })),
      });
    },

    // POST /api/admin/[slug]/staff/invites  { email, role }
    async inviteStaff(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const body = inviteBody.safeParse(await readJson(request));
      if (!body.success) return badRequest();
      const { data, error } = await db.rpc('invite_staff', { p_event_id: g.eventId, p_email: body.data.email, p_role: body.data.role, p_actor: g.userId });
      if (error) throw new Error(`invite_staff failed (${error.code})`);
      return json({ code: data });
    },

    // DELETE /api/admin/[slug]/staff/invites/[email]
    async cancelInvite(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const email = normalizeEmail(decodeURIComponent(params.email ?? ''));
      const { error } = await db.from('staff_invites').delete().eq('event_id', g.eventId).eq('email', email);
      if (error) throw new Error(`invite delete failed (${error.code})`);
      return json({ code: 'CANCELLED' });
    },

    // DELETE /api/admin/[slug]/staff/[userId]
    async removeStaff(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const userId = uuid(params.userId);
      if (!userId) return notFound();
      const { data, error } = await db.rpc('remove_staff', { p_event_id: g.eventId, p_user_id: userId, p_actor: g.userId });
      if (error) throw new Error(`remove_staff failed (${error.code})`);
      if (data === 'NOT_FOUND') return notFound();
      if (data === 'LAST_ORGANIZER') return json({ code: data }, 409);
      return json({ code: data });
    },

    // GET /api/admin/[slug]/event
    async getEvent(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const [e, { data: lastSync, error }] = await Promise.all([
        loadEvent(g.eventId),
        db.from('audit_log').select('created_at').eq('event_id', g.eventId).eq('action', 'sheet.sync').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (error) throw new Error(`last sync load failed (${error.code})`);
      return json({
        name: e.name,
        venue: e.venue,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        timezone: e.timezone,
        sheetId: e.sheet_id,
        lastSyncAt: lastSync ? new Date(lastSync.created_at).toISOString() : null,
      });
    },

    // PATCH /api/admin/[slug]/event  { sheet: id | URL | null }
    async updateEvent(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const body = z.object({ sheet: z.string().max(500).nullable() }).strict().safeParse(await readJson(request));
      if (!body.success) return badRequest();
      const sheetId = body.data.sheet === null ? null : parseSheetId(body.data.sheet);
      if (body.data.sheet !== null && sheetId === null) return badRequest();
      const { error } = await db.from('events').update({ sheet_id: sheetId }).eq('id', g.eventId);
      if (error) throw new Error(`event update failed (${error.code})`);
      await audit(g.eventId, g.userId, 'event.sheet_link', g.eventId, { linked: sheetId !== null });
      return json({ sheetId });
    },

    // POST /api/admin/[slug]/sync  { dryRun }  (F10)
    async syncSheet(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const body = z.object({ dryRun: z.boolean() }).strict().safeParse(await readJson(request));
      if (!body.success) return badRequest();
      const { sheet_id: sheetId } = await loadEvent(g.eventId);
      const readSheet = sheetId ? deps.sheetReader?.(sheetId) : null;
      if (!readSheet) return json({ error: 'NOT_CONFIGURED' }, 409);
      let values: string[][];
      try {
        values = await readSheet();
      } catch {
        return json({ error: 'SHEET_READ_FAILED' }, 502);
      }
      let report: Awaited<ReturnType<typeof syncSheet>>;
      try {
        report = await syncSheet(db, g.eventId, { dryRun: body.data.dryRun, readSheet: async () => values, actorUserId: g.userId });
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Missing header')) return json({ error: 'BAD_SHEET', message: err.message }, 422);
        throw err;
      }
      if (!report.dryRun && (report.counts.PASS_QUEUED ?? 0) > 0) deps.scheduleDrain(deps.drain);
      return json(report);
    },

    // GET /api/admin/[slug]/export/[kind]  (§11, I-13: everything through toCsv)
    async exportCsv(request: Request, params: Params) {
      const g = await guard(request, params);
      if (g instanceof Response) return g;
      const kind = params.kind ?? '';
      const slug = params.slug ?? '';
      const event = await loadEvent(g.eventId);
      const local = (iso: string | null) => (iso ? formatEventDateTime(iso, event.timezone) : '');

      if (kind === 'participants.csv') {
        const { data, error } = await db.rpc('admin_participants', { p_event_id: g.eventId });
        if (error) throw new Error(`admin_participants failed (${error.code})`);
        const { data: doors, error: doorError } = await db
          .from('scans')
          .select('participant_id, scanned_at, checkpoints!inner(kind)')
          .eq('event_id', g.eventId)
          .eq('checkpoints.kind', 'door')
          .is('voided_at', null);
        if (doorError) throw new Error(`door scans load failed (${doorError.code})`);
        const checkedInAt = new Map(doors.map((d) => [d.participant_id, d.scanned_at]));
        return csvResponse(
          slug,
          kind,
          toCsv(
            ['first_name', 'last_name', 'email', 'status', 'source', 'is_test', 'dietary_notes', 'checked_in_at_local', 'has_photo', 'applicant_id'],
            data.map((p) => [
              p.first_name, p.last_name, p.email, p.status, p.source, p.is_test, p.dietary_notes,
              local(checkedInAt.get(p.id) ?? null), p.photo_path !== null, p.external_id,
            ]),
          ),
        );
      }

      if (kind === 'scans.csv') {
        const includeVoided = new URL(request.url).searchParams.get('includeVoided') === '1';
        let q = db
          .from('scans')
          .select('scanned_at, method, scanned_by, voided_at, void_reason, checkpoints(name, kind), participants(first_name, last_name, is_test)')
          .eq('event_id', g.eventId)
          .order('scanned_at');
        if (!includeVoided) q = q.is('voided_at', null);
        const { data, error } = await q;
        if (error) throw new Error(`scans load failed (${error.code})`);
        const names = await staffNames(data.map((s) => s.scanned_by));
        return csvResponse(
          slug,
          kind,
          toCsv(
            ['scanned_at_utc', 'scanned_at_local', 'checkpoint', 'kind', 'first_name', 'last_name', 'is_test', 'method', 'scanned_by', 'voided_at_utc', 'void_reason'],
            data.map((s) => [
              s.scanned_at, local(s.scanned_at), s.checkpoints.name, s.checkpoints.kind, s.participants.first_name,
              s.participants.last_name, s.participants.is_test, s.method, names.get(s.scanned_by) ?? '', s.voided_at, s.void_reason,
            ]),
          ),
        );
      }

      if (kind === 'summary.csv') {
        const m = await metrics(g.eventId);
        return csvResponse(
          slug,
          kind,
          toCsv(
            ['checkpoint', 'kind', 'capacity', 'live_scans', 'fill'],
            m.checkpoints.map((c) => [c.name, c.kind, c.capacity, c.liveScans, c.capacity ? round4(c.liveScans / c.capacity) : null]),
          ),
        );
      }

      return notFound();
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;

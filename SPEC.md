# Passline — Product & Technical Specification

> **Status:** Draft v0.1 · **Owner:** Ade · **Last updated:** 2026-09-23
> "Passline" is a placeholder name. Rename freely; nothing depends on it.

## 0. How to read this document

- **MUST / MUST NOT / SHOULD / MAY** are used as in RFC 2119.
- Every MUST has at least one test in §14. Test IDs look like `T-SCAN-11`. Code and test names reference them.
- Anything marked **DECISION** was a deliberate trade-off. Don't "fix" it without updating this spec.
- Anything we have not confirmed against real docs or devices is listed in §17 (Assumptions to verify). Treat those as hypotheses until checked.
- If this spec and the code disagree, the spec wins until the spec is changed. Changes to behaviour go in the changelog (§20).

---

## 1. Problem & goals

The club runs tech and networking events. People apply through a Google Form, which writes to a Google Sheet. Organizers decide acceptance in the Sheet. Today, check-in, food distribution and workshop attendance are tracked by hand, or not tracked at all.

| ID | Goal | Measure |
|----|------|---------|
| G1 | An accepted applicant gets a personal QR pass by email automatically | ≤ 5 min from `Status = Accepted` in the Sheet to the email being sent (p95) |
| G2 | Fast, duplicate-proof door check-in | ≤ 3 s per person, from the code entering the frame to the result on screen |
| G3 | At most one serving per participant per meal | 0 duplicate live meal scans, enforced by the database |
| G4 | Workshop/session attendance recorded | Every session scan attributable to a participant and a time |
| G5 | Organizers see live counts and post-event analytics | Dashboard refresh ≤ 10 s; CSV export |

### Non-goals (v1)

The following are out of scope for v1:
- Ticket sales or payments.
- Hosting the application form (Google Forms stays).
- **Offline scanning** (DECISION: this roughly doubles complexity; a paper fallback is covered in §16).
- LinkedIn sign-in or scraping.
- Native apps and Apple/Google Wallet passes.
- Checkpoints that allow unlimited scans per participant.
- Multi-club tenancy.

### v2 candidates (do not build yet)

- A Wallet pass (`.pkpass`).
- "Contact swap", where a participant scans another participant's pass to save their opted-in LinkedIn URL.
- Co-attendance analytics UI.
- Offline queue with sync.
- Unlimited-scan checkpoints (booth visit counters).

---

## 2. Glossary

| Term | Meaning |
|------|---------|
| **Event** | One dated occurrence (e.g. `hackday-2026`). All data is scoped to an event. |
| **Participant** | An applicant row imported from the Sheet (or a walk-in), with a `status`. |
| **Pass** | A credential issued to an accepted participant. At most one is **active** at a time. |
| **Token** | The secret random string inside a pass's QR code. It is never stored raw; only `sha256(token)` is stored. |
| **Checkpoint** | A place where scans happen: `door`, `meal`, `session`, or `custom` (swag, raffle, booth). |
| **Scan** | A recorded participant × checkpoint event. It is **live** if `voided_at IS NULL`. |
| **Void** | Soft-undo of a scan. Voided scans are excluded from every rule and count. |
| **Staff** | An authenticated user with a role on an event: `organizer` or `volunteer`. |
| **Door check-in** | A live scan at the event's single `door` checkpoint. |
| **Outbox** | A queue table of emails to send. Emails are never sent inline in a request. |

---

## 3. Actors & permissions

| Action | Anonymous | Pass holder (has token) | Volunteer | Organizer |
|--------|:-:|:-:|:-:|:-:|
| View own pass page (`/p#token`) | — | ✅ | — | — |
| Upload/replace own photo (until checked in) | — | ✅ | — | — |
| Scan at a checkpoint of their event | — | — | ✅ | ✅ |
| Manual search + manual scan | — | — | ✅ (masked email) | ✅ (full email) |
| Void own scan ≤ 120 s old | — | — | ✅ | ✅ |
| Void any scan | — | — | — | ✅ |
| Open/close checkpoints, CRUD checkpoints | — | — | — | ✅ |
| Resend/revoke pass, add walk-in, delete participant | — | — | — | ✅ |
| Invite/remove staff | — | — | — | ✅ |
| Dashboard, analytics, CSV export | — | — | — | ✅ |
| Sheet ingest endpoint | HMAC-signed Apps Script only | | | |

Authorization is always checked **server-side**. Hiding a button is not authorization.

---

## 4. Architecture

```
Google Form ──► Google Sheet ──(Apps Script onEdit, HMAC-signed POST)──► /api/ingest/sheet
                     ▲                                                          │
                     └──────────── "Sync now" (Sheets API, service acct) ◄──────┤
                                                                                ▼
 Participant email ◄── Email provider ◄── outbox drainer ◄── Postgres (Supabase) ◄── Next.js route handlers
        │                                                          ▲
        ▼                                                          │
  /p#<token> pass page ── POST /api/pass ─────────────────────────┤
                                                                   │
 Volunteer phone: /scan/<event> ── camera ── POST /api/scan ── record_scan() (single SQL function)
 Organizer: /admin/<event> ── dashboard, participants, checkpoints, staff, sync, export
```

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js (App Router), TypeScript `strict` | Route handlers are the only API surface |
| Hosting | Vercel | Co-locate the function region with the DB region |
| DB/Auth/Storage | Supabase (Postgres, Auth, Storage) | Local dev via `supabase start` (Docker) |
| Email | Transactional provider (Resend assumed, §17 A1) | `EMAIL_PROVIDER=console` in dev/test |
| QR generation | `qrcode` (npm) | Server PNG for email; client canvas on pass page |
| QR scanning | Library behind a `QrScanner` interface (§17 A7) | Swappable |
| Validation | `zod` at every boundary | Request bodies, Sheet rows, env vars |
| Image processing | `sharp` | Resize, auto-orient, strip metadata |
| Tests | Vitest (unit + integration), Playwright (e2e), pgTAP optional | See §14 |

### Architectural principles

1. **The browser never queries Supabase tables.** All data access goes through Next.js route handlers or server actions. These use a server-only service-role client **after** an explicit authorization check. RLS is enabled on every table with **no policies** (deny-all), so a leaked anon key exposes nothing. DECISION: this centralizes authorization in app code, which is easier to reason about than per-table policies for a small team. The cost is that route-level authorization tests are mandatory (T-SEC-04).
2. **Postgres is the source of truth for event-day state.** The Sheet is the source of truth for acceptance decisions.
3. **Every scan decision happens in one SQL function, `record_scan()`.** That means one round trip and one transaction, with the database enforcing uniqueness. App code MUST NOT read scan state and then write it.
4. **Server time is authoritative.** Client timestamps are stored for diagnostics only.
5. **Constraints live in the database.** Uniqueness, foreign keys, cross-event consistency and checks are enforced by Postgres, not just in TypeScript.

---

## 5. Data model

Migration `0001_init.sql` (reference implementation; the tests in §14 are authoritative):

```sql
create extension if not exists pgcrypto;  -- gen_random_uuid()
create extension if not exists pg_trgm;   -- fuzzy name search

create type participant_status as enum ('pending','accepted','waitlisted','rejected','withdrawn');
create type staff_role        as enum ('organizer','volunteer');
create type checkpoint_kind   as enum ('door','meal','session','custom');
create type scan_method       as enum ('qr','manual');
create type outbox_status     as enum ('pending','sending','sent','failed','cancelled');

create table events (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name       text not null,
  venue      text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  timezone   text not null default 'America/Toronto',
  sheet_id   text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table staff_profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text not null check (length(display_name) between 1 and 60)
);

create table event_staff (
  event_id uuid not null references events on delete cascade,
  user_id  uuid not null references auth.users on delete cascade,
  role     staff_role not null,
  added_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- Organizers invite by email; consumed on first sign-in (§7 F9).
create table staff_invites (
  event_id uuid not null references events on delete cascade,
  email    text not null check (email = lower(btrim(email))),
  role     staff_role not null,
  primary key (event_id, email)
);

create table participants (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events on delete cascade,
  external_id      text,                       -- "Applicant ID" from the Sheet; null for walk-ins
  email            text not null check (email = lower(btrim(email))),
  first_name       text not null check (length(first_name) between 1 and 100),
  last_name        text not null default '' check (length(last_name) <= 100),
  search_text      text not null,              -- normalized by app: see §10.4
  dietary_notes    text check (length(dietary_notes) <= 500),
  linkedin_url     text check (linkedin_url ~ '^https://(www\.)?linkedin\.com/in/[A-Za-z0-9_%-]+/?$'),
  photo_path       text,
  photo_updated_at timestamptz,
  status           participant_status not null,
  source           text not null check (source in ('sheet','walk_in','seed')),
  is_test          boolean not null default false,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, event_id),          -- target for composite FKs
  unique (event_id, external_id), -- NULLs allowed (walk-ins)
  unique (event_id, email)
);
create index participants_search_trgm on participants using gin (search_text gin_trgm_ops);

create table passes (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants on delete cascade,
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'), -- hex sha256
  issued_at      timestamptz not null default now(),
  revoked_at     timestamptz,
  revoke_reason  text check (revoke_reason in ('rotated','status_change','manual','deleted')),
  check ((revoked_at is null) = (revoke_reason is null))
);
create unique index passes_one_active on passes (participant_id) where revoked_at is null;

create table checkpoints (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events on delete cascade,
  name             text not null,
  kind             checkpoint_kind not null,
  requires_checkin boolean not null default true,
  capacity         int check (capacity > 0),
  is_open          boolean not null default false,  -- manual toggle is authoritative (DECISION)
  starts_at        timestamptz,                     -- informational: schedule + analytics
  sort_order       int not null default 0,
  unique (id, event_id),
  unique (event_id, name),
  check (kind <> 'door' or requires_checkin = false)
);
create unique index checkpoints_one_door on checkpoints (event_id) where kind = 'door';

create table scans (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null,
  participant_id    uuid not null,
  checkpoint_id     uuid not null,
  pass_id           uuid references passes,
  method            scan_method not null,
  scanned_by        uuid not null references auth.users,
  scanned_at        timestamptz not null default now(),
  client_scan_id    uuid not null unique,
  client_scanned_at timestamptz,
  voided_at         timestamptz,
  voided_by         uuid references auth.users,
  void_reason       text check (length(void_reason) between 3 and 200),
  -- A scan can never join a participant and a checkpoint from different events:
  foreign key (participant_id, event_id) references participants (id, event_id),
  foreign key (checkpoint_id,  event_id) references checkpoints  (id, event_id),
  check ((method = 'qr') = (pass_id is not null)),
  check ((voided_at is null) = (voided_by is null)),
  check ((voided_at is null) = (void_reason is null))
);
create unique index scans_one_live       on scans (participant_id, checkpoint_id) where voided_at is null;
create index        scans_checkpoint_time on scans (checkpoint_id, scanned_at)    where voided_at is null;

-- Every attempt, including failures. Feeds rate limiting, alerts and debugging. No PII.
create table scan_attempts (
  id             bigint generated always as identity primary key,
  event_id       uuid references events,
  checkpoint_id  uuid references checkpoints,
  staff_user_id  uuid references auth.users,
  participant_id uuid,
  result_code    text not null,
  latency_ms     int,
  created_at     timestamptz not null default now()
);
create index scan_attempts_staff_time on scan_attempts (staff_user_id, created_at);

create table email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  participant_id      uuid not null references participants,
  kind                text not null check (kind in ('pass_issued','pass_reissued')),
  status              outbox_status not null default 'pending',
  attempts            int not null default 0,
  next_attempt_at     timestamptz not null default now(),
  locked_until        timestamptz,
  last_error          text check (length(last_error) <= 500),
  provider_message_id text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create unique index outbox_one_inflight on email_outbox (participant_id) where status in ('pending','sending');
create index        outbox_due          on email_outbox (next_attempt_at) where status = 'pending';

create table audit_log (
  id            bigint generated always as identity primary key,
  event_id      uuid references events,
  actor_user_id uuid references auth.users,
  actor_kind    text not null check (actor_kind in ('staff','sheet_sync','system','participant')),
  action        text not null,              -- e.g. 'scan.void', 'pass.resend', 'participant.delete'
  subject_id    uuid,
  detail        jsonb not null default '{}', -- MUST NOT contain names, emails or tokens
  created_at    timestamptz not null default now()
);

create table rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);

-- Deny-all RLS on every table in public. New tables MUST be covered (T-SEC-02 enforces this).
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
```

### 5.1 Data-model rules

- **One active pass per participant** is enforced by `passes_one_active`. Issuing a pass MUST go through `issue_pass()` (§6.3).
- **Once per checkpoint** is enforced by `scans_one_live`. Voiding a scan frees the slot.
- **Cross-event scans are impossible**, enforced by the composite foreign keys (T-SCAN-22).
- **Exactly one door checkpoint per event** is enforced by `checkpoints_one_door`.
- **Never hard-delete scans.** Void them instead.
- **Participant deletion is a tombstone.** Set `deleted_at`, set `first_name = 'Deleted'`, `last_name = ''`, `email = 'deleted+<id>@invalid'`, set `search_text = ''`, and null out dietary notes, LinkedIn and photo (deleting the photo object from storage). Revoke the pass with reason `deleted`. Scans remain, so aggregate counts stay correct.
- **Any view** MUST be created `with (security_invoker = true)`, and `select` on it MUST be revoked from `anon` and `authenticated`. Views otherwise run with owner privileges and bypass RLS.
- **Any function** in `public` MUST have `revoke all ... from public, anon, authenticated` and `grant execute ... to service_role`. Postgres grants EXECUTE to PUBLIC by default. SECURITY DEFINER functions MUST `set search_path = public, pg_temp` (T-SEC-08).

---

## 6. Tokens, passes & QR codes

### 6.1 Token

- Generate with `crypto.randomBytes(24).toString('base64url')`. This gives 32 characters, charset `[A-Za-z0-9_-]`, 192 bits of entropy.
- Store `sha256(token)` as lowercase hex in `passes.token_hash`. The raw token MUST NOT be written to the DB, logs, analytics, error trackers, URLs' path or query string, or `audit_log`.
- The token exists in plaintext only in these places:
  - in memory during email rendering,
  - inside the email,
  - inside the QR code,
  - in the pass page's URL **fragment**,
  - in POST bodies to `/api/scan` and `/api/pass*`.

### 6.2 QR payload

- The payload is exactly `${APP_ORIGIN}/p#${token}`.
- **Why a URL:** if a participant scans their own code with their phone camera, it opens their pass page.
- **Why a fragment:** browsers do not send the fragment to the server, so the token never appears in server or CDN access logs.
- No PII is ever in the QR code.
- Render settings:
  - error correction **M** (about 15% recovery),
  - quiet zone of **4 modules**,
  - **opaque white background** (`#FFFFFFFF`), dark modules `#000000`,
  - PNG width 600 px.
- The background MUST be opaque. A transparent PNG in dark-mode email clients shows black modules on a dark background, which will not scan.

### 6.3 Pass issuance — `issue_pass()`

```sql
create or replace function public.issue_pass(p_participant_id uuid, p_token_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  perform 1 from participants where id = p_participant_id for update;  -- serialize issuance
  update passes set revoked_at = now(), revoke_reason = 'rotated'
   where participant_id = p_participant_id and revoked_at is null;
  insert into passes (participant_id, token_hash) values (p_participant_id, p_token_hash)
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.issue_pass(uuid, text) from public, anon, authenticated;
grant execute on function public.issue_pass(uuid, text) to service_role;
```

**DECISION: rotate on every send.** Because only hashes are stored, a pass cannot be "resent". Every send, including an organizer's Resend, issues a new token and revokes the old one. Scanning an old token returns `REVOKED` with `reissued = true`, and the UI tells the volunteer to ask for the latest email.

### 6.4 Parsing scanned text (client and server)

`parseScannedText(raw: string): { ok: true, token } | { ok: false, reason }`
1. Trim whitespace.
2. If `raw` matches `^${APP_ORIGIN}/p#([A-Za-z0-9_-]{32})$`, return the captured token.
3. Else if `raw` matches `^[A-Za-z0-9_-]{32}$`, return it (manual paste or printed fallback).
4. Anything else returns `MALFORMED`. This includes other origins, `http:` in production, extra query or fragment parameters, Wi-Fi QR codes, vCards, and strings over 2 KB. `MALFORMED` MUST NOT trigger a network request, and parsing MUST NOT throw.

---

## 7. Flows

### F1 — Application intake (no code)

1. Participants apply through the Google Form, which writes to the Sheet.
2. The Sheet has three extra columns added by organizers: `Applicant ID`, `Status` and `Sync Status`.
3. `Status` MUST use data validation limited to these values: *(blank)*, `Accepted`, `Waitlisted`, `Rejected`, `Withdrawn`.

### F2 — Applicant ID assignment

The installable `onFormSubmit` trigger writes `Utilities.getUuid()` into `Applicant ID` for the new row (Appendix A). **Row identity is Applicant ID, never the row number or email.** People sort sheets, and people change emails.

### F3 — Acceptance sync

1. An organizer edits `Status` (one cell or a multi-row paste).
2. The installable `onEdit` trigger fires. If the edited range intersects the `Status` column, the script reads **every row in the edited range** and POSTs them in one signed request (§9.2).
3. The server upserts each row using the transition table below and returns per-row results **in request order**.
4. Apps Script writes each result into `Sync Status` (e.g. `PASS_QUEUED 2026-10-03T14:02:11Z`, or `ERROR HTTP 500`).
5. If the trigger was missed or failed, an organizer uses **Sync now** (F10) to reconcile.

**Status normalization:** trim and lowercase. Blank maps to `pending`. The accepted values are `accepted`, `waitlisted`, `rejected` and `withdrawn`. Anything else returns `INVALID:status` for that row.

**Transition table** (per row, keyed by `(event_id, external_id)`):

| Existing | Incoming | Action | Row result |
|----------|----------|--------|-----------|
| none | pending / waitlisted / rejected / withdrawn | insert participant | `CREATED` |
| none | accepted | insert, enqueue `pass_issued` | `PASS_QUEUED` |
| not accepted | accepted | update status, enqueue `pass_issued` | `PASS_QUEUED` |
| accepted | accepted, same email | update name/dietary if changed | `UNCHANGED` or `UPDATED` |
| accepted | accepted, **different email** | update email, enqueue `pass_reissued` (rotation revokes old) | `PASS_QUEUED` |
| accepted | waitlisted / rejected / withdrawn | update status, revoke active pass (`status_change`), cancel in-flight outbox | `REVOKED` |
| accepted | pending (cell cleared) | **no change** (DECISION: accidental deletes must not kill passes) | `IGNORED_CLEAR` |
| any | invalid row | nothing | `INVALID:<field,field>` |
| none, but email already used by another `external_id` in this event | — | nothing | `CONFLICT_DUPLICATE_EMAIL` |

Rows are processed independently, so one bad row never fails the batch. The whole request MUST be idempotent: replaying an identical request produces no new participants, passes or emails.

### F4 — Pass email (outbox drain)

Draining is triggered by three things:
- (a) Next.js `after()` following an ingest or resend,
- (b) the admin **Send pending** button,
- (c) a scheduled job every minute (Supabase `pg_cron` + `pg_net` POSTing to `/api/email/drain` with `DRAIN_SECRET`; §17 A5).

**Claim** (safe with concurrent drainers):
```sql
update email_outbox o
   set status = 'sending', locked_until = now() + interval '2 minutes', attempts = attempts + 1
 where o.id in (
   select id from email_outbox
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'sending' and locked_until < now())      -- crashed drainer's lease expired
    order by next_attempt_at
    limit 20
    for update skip locked)
returning o.*;
```

**Per claimed row, in this order:**
1. Reload the participant. If it is not `accepted` or is deleted, set the row to `cancelled` and stop.
2. Generate the token. Call `issue_pass(participant_id, sha256hex(token))`. **This commits before sending** (I-10). The emailed token must already be valid when it lands.
3. Render the email (§12) and send it through the provider. Use the provider's idempotency key (`outbox.id:attempts`) if supported (§17 A1).
4. On success: set `status = 'sent'`, `sent_at`, and `provider_message_id`.
5. On failure: set `status = 'pending'`, `next_attempt_at = now() + backoff[attempts]` (1 min, 5 min, 25 min, 2 h), and `last_error` (truncated, no PII). After 5 attempts, set `status = 'failed'`, which surfaces on the dashboard. On a 429, honor `Retry-After`.

**Known edge (accepted):** if the provider accepted the send but marking the row `sent` failed, the retry rotates the pass and sends a second email. Only the newest code works. This is safe, just noisy.

### F5 — Pass page & photo

1. The participant opens `/p#<token>`. Client JS reads `location.hash` and POSTs `{ token }` to `/api/pass`.
2. The response carries `state`:
   - `active`: first name, event name/venue/local time, photo status, and whether the photo is locked. The page renders the QR client-side with the §6.2 settings.
   - `replaced`: "This pass was replaced. Check your most recent email."
   - `cancelled`: "This pass is no longer valid. Contact the organizers."
   - Not found: a generic "Pass not found". Do not distinguish further (no enumeration).
3. Photo upload goes to `POST /api/pass/photo` (multipart: token + file).
   - Accept JPEG/PNG/WebP up to 8 MB, verified by **magic bytes**, not extension or claimed MIME type. The file input uses `accept="image/jpeg,image/png,image/webp"` (§17 A3).
   - Process with `sharp`: auto-orient with `.rotate()`, crop and resize to a 512×512 cover, encode JPEG q80. Metadata is stripped by default. **GPS EXIF MUST be absent** in the output.
   - Store at `photos/<event_id>/<participant_id>.jpg` in a **private** bucket. Set `photo_path` and `photo_updated_at`.
   - Locked after door check-in (`409 PHOTO_LOCKED`). Limit: 10 uploads per pass per hour.
   - Staff see photos only through signed URLs with a 300 s expiry.

**Known limitation:** someone holding a forwarded token could upload their own photo before the event. The photo is a speed-bump, not proof of identity. Organizers can see `photo_updated_at`.

### F6 — Door check-in

1. The volunteer signs in and opens `/scan/<event-slug>`, then selects a checkpoint (persisted per device).
2. The camera decodes a QR code, and `parseScannedText` runs.
3. On `MALFORMED`, the volunteer sees an amber screen and no request is sent.
4. Otherwise, POST `/api/scan` with a fresh `clientScanId` (UUID v4).
5. The server authenticates, rate-limits, hashes the token and calls `record_scan()`. It logs to `scan_attempts` and returns a `ScanResponse` (§9.1).
6. The client renders the result (§10.2). While a result is on screen, scanning is paused.

### F7 — Meals

Same as F6 at a `meal` checkpoint with `requires_checkin = true`. The response includes `dietaryNotes` **only** for meal checkpoints. Each meal is its own checkpoint (e.g. "Lunch Sat", "Dinner Sat").

### F8 — Sessions, workshops & custom checkpoints

- **Sessions:** `kind = session`, with optional `capacity`. This feeds attendance analytics.
- **Custom:** swag pickup, raffle entry, sponsor booth. These are once per participant in v1. `requires_checkin` is configurable (e.g. a raffle desk outside the venue sets it to false).

### F9 — Staff onboarding

1. An organizer enters an email and role on `/admin/<slug>/staff`, which creates a `staff_invites` row.
2. The staff member signs in with a Supabase Auth magic link (or Google OAuth). The first time, they set `display_name`.
3. The auth callback consumes every invite matching their verified, lowercased email: it inserts `event_staff` rows and deletes the invites.
4. Removing a staff member deletes the `event_staff` row. Their **next** scan returns `FORBIDDEN`, with no caching of roles.

### F10 — Sync now (reconcile)

1. Read the entire Sheet through the Sheets API, with the Sheet shared to the service-account email.
2. Run the **same** upsert code as F3 in **dry-run** mode, producing a diff (counts per result, plus the rows that would change).
3. The organizer reviews and confirms, then the diff is applied.
4. Record `audit_log` action `sheet.sync` with counts only.

### F11 — Void (undo)

- Volunteers can void **their own** scan within **120 s**. Organizers can void any scan, at any time.
- A reason is required (3–200 chars).
- Voiding sets `voided_at`, `voided_by` and `void_reason`, and writes an `audit_log` entry.
- DECISION: voiding a door scan does **not** cascade to later meal or session scans.

### F12 — Walk-ins

An organizer adds a walk-in with name and email (source `walk_in`, status `accepted`). An optional "check in now" performs a manual door scan. Sending a pass email is optional.

---

## 8. Scan decision procedure — `record_scan()`

The **order matters**, and the tests pin it down. On every early return, nothing is written to `scans`.

| # | Check | Result code |
|---|-------|-------------|
| 1 | `client_scan_id` already exists → same staff: replay; different staff: conflict | `ACCEPTED` (`replayed: true`) / `CLIENT_ID_CONFLICT` |
| 2 | Checkpoint exists | `CHECKPOINT_NOT_FOUND` |
| 3 | Caller is staff on the checkpoint's event | `FORBIDDEN` |
| 4 | Resolve participant (QR: pass by hash; manual: id, not deleted) | `NOT_FOUND` |
| 5 | QR only: pass not revoked | `REVOKED` (+ `reissued`, `revokeReason`) |
| 6 | Participant's event = checkpoint's event | `WRONG_EVENT` (+ other event name; no participant data) |
| 7 | Participant `status = accepted` | `NOT_ACCEPTED` (+ status) |
| 8 | Checkpoint `is_open` | `CHECKPOINT_CLOSED` |
| 9 | If capacity is set: lock the checkpoint row **before** step 10 | — |
| 10 | No live scan exists for (participant, checkpoint). If one exists with **this** `client_scan_id`, it's a replay that committed after step 1 | `ALREADY_SCANNED` (+ previous scan info) / `ACCEPTED` (`replayed: true`) |
| 11 | If `requires_checkin`: a live door scan exists | `NOT_CHECKED_IN` |
| 12 | If capacity is set: live count < capacity | `CAPACITY_REACHED` |
| 13 | Insert. On conflict with the arbiter index, re-read: same `client_scan_id` means replay, otherwise `ALREADY_SCANNED` | `ACCEPTED` |

Why step 9 comes before step 10: without the lock, two simultaneous scans of the *same* person at a nearly full session could return `CAPACITY_REACHED` to the second scan instead of `ALREADY_SCANNED` (T-SCAN-11, T-CONC-06).

Reference implementation:

```sql
create or replace function public._who(pa participants, k checkpoint_kind)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', pa.id,
    'displayName', btrim(pa.first_name || ' ' || pa.last_name),
    'photoPath', pa.photo_path,
    'status', pa.status,
    'dietaryNotes', case when k = 'meal' then pa.dietary_notes end)
$$;

create or replace function public._prior(s scans, me uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'scannedAt', s.scanned_at,
    'scannedByName', (select display_name from staff_profiles where user_id = s.scanned_by),
    'scannedByMe', s.scanned_by = me)
$$;

create or replace function public.record_scan(
  p_checkpoint_id     uuid,
  p_staff_user_id     uuid,
  p_method            scan_method,
  p_token_hash        text,         -- required iff p_method = 'qr'
  p_participant_id    uuid,         -- required iff p_method = 'manual'
  p_client_scan_id    uuid,
  p_client_scanned_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cp checkpoints%rowtype; pa participants%rowtype; ps passes%rowtype; prior scans%rowtype;
  live_n int; new_id uuid; who jsonb;
begin
  -- 1. replay
  select * into prior from scans where client_scan_id = p_client_scan_id;
  if found then
    if prior.scanned_by <> p_staff_user_id then
      return jsonb_build_object('code','CLIENT_ID_CONFLICT');
    end if;
    select * into cp from checkpoints  where id = prior.checkpoint_id;
    select * into pa from participants where id = prior.participant_id;
    return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,
      'voided', prior.voided_at is not null, 'participant', _who(pa, cp.kind));
  end if;

  -- 2-3. checkpoint + authz
  select * into cp from checkpoints where id = p_checkpoint_id;
  if not found then return jsonb_build_object('code','CHECKPOINT_NOT_FOUND'); end if;
  if not exists (select 1 from event_staff where event_id = cp.event_id and user_id = p_staff_user_id) then
    return jsonb_build_object('code','FORBIDDEN');
  end if;

  -- 4. resolve
  if p_method = 'qr' then
    select * into ps from passes where token_hash = p_token_hash;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
    select * into pa from participants where id = ps.participant_id;
  else
    select * into pa from participants where id = p_participant_id and deleted_at is null;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  end if;
  who := _who(pa, cp.kind);

  -- 5. revoked
  if p_method = 'qr' and ps.revoked_at is not null then
    return jsonb_build_object('code','REVOKED','participant',who,'revokeReason',ps.revoke_reason,
      'reissued', exists (select 1 from passes where participant_id = pa.id and revoked_at is null));
  end if;

  -- 6-8. event, status, open
  if pa.event_id <> cp.event_id then
    return jsonb_build_object('code','WRONG_EVENT','otherEvent',(select name from events where id = pa.event_id));
  end if;
  if pa.status <> 'accepted' then return jsonb_build_object('code','NOT_ACCEPTED','participant',who); end if;
  if not cp.is_open then return jsonb_build_object('code','CHECKPOINT_CLOSED','participant',who); end if;

  -- 9. serialize capacity-limited checkpoints
  if cp.capacity is not null then
    perform 1 from checkpoints where id = cp.id for update;
  end if;

  -- 10. already scanned (a concurrent retry of THIS scan may have committed after step 1)
  select * into prior from scans where participant_id = pa.id and checkpoint_id = cp.id and voided_at is null;
  if found then
    if prior.client_scan_id = p_client_scan_id then
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'participant',who);
    end if;
    return jsonb_build_object('code','ALREADY_SCANNED','participant',who,'previous',_prior(prior, p_staff_user_id));
  end if;

  -- 11. door prerequisite
  if cp.requires_checkin and not exists (
      select 1 from scans s join checkpoints d on d.id = s.checkpoint_id
       where s.participant_id = pa.id and d.kind = 'door' and s.voided_at is null) then
    return jsonb_build_object('code','NOT_CHECKED_IN','participant',who);
  end if;

  -- 12. capacity
  if cp.capacity is not null then
    select count(*) into live_n from scans where checkpoint_id = cp.id and voided_at is null;
    if live_n >= cp.capacity then
      return jsonb_build_object('code','CAPACITY_REACHED','participant',who,'capacity',cp.capacity);
    end if;
  end if;

  -- 13. insert
  begin
    insert into scans (event_id, participant_id, checkpoint_id, pass_id, method,
                       scanned_by, client_scan_id, client_scanned_at)
    values (cp.event_id, pa.id, cp.id, case when p_method = 'qr' then ps.id end, p_method,
            p_staff_user_id, p_client_scan_id, p_client_scanned_at)
    on conflict (participant_id, checkpoint_id) where voided_at is null do nothing
    returning id into new_id;
  exception when unique_violation then
    -- client_scan_id collided (a concurrent retry of this same scan won the race)
    select * into prior from scans where client_scan_id = p_client_scan_id;
    if found and prior.scanned_by = p_staff_user_id then
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'participant',who);
    end if;
    return jsonb_build_object('code','CLIENT_ID_CONFLICT');
  end;

  if new_id is null then
    select * into prior from scans where participant_id = pa.id and checkpoint_id = cp.id and voided_at is null;
    if prior.client_scan_id = p_client_scan_id then
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'participant',who);
    end if;
    return jsonb_build_object('code','ALREADY_SCANNED','participant',who,'previous',_prior(prior, p_staff_user_id));
  end if;

  return jsonb_build_object('code','ACCEPTED','replayed',false,'scanId',new_id,'participant',who);
end $$;

revoke all on function public._who(participants, checkpoint_kind) from public, anon, authenticated;
revoke all on function public._prior(scans, uuid)                 from public, anon, authenticated;
revoke all on function public.record_scan(uuid,uuid,scan_method,text,uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.record_scan(uuid,uuid,scan_method,text,uuid,uuid,timestamptz) to service_role;
```

A `void_scan(p_scan_id, p_staff_user_id, p_reason)` function follows the same pattern. It returns `VOIDED`, `NOT_FOUND`, `FORBIDDEN` (not staff; or a volunteer voiding someone else's scan, or a scan older than 120 s), or `ALREADY_VOIDED`.

---

## 9. API contracts

All request bodies are validated with zod, and unknown keys are rejected (`.strict()`). All responses are JSON. Domain outcomes return **HTTP 200** with a `code`. HTTP errors are reserved for transport, auth or validation failures.

### 9.1 `POST /api/scan` (staff session required)

```ts
// Request
{ checkpointId: string /*uuid*/, method: 'qr' | 'manual',
  token?: string /*^[A-Za-z0-9_-]{32}$, iff qr*/, participantId?: string /*uuid, iff manual*/,
  clientScanId: string /*uuid v4*/, clientScannedAt: string /*ISO 8601*/ }

// 200 Response
type ScanCode = 'ACCEPTED' | 'ALREADY_SCANNED' | 'NOT_FOUND' | 'REVOKED' | 'NOT_ACCEPTED'
  | 'WRONG_EVENT' | 'NOT_CHECKED_IN' | 'CHECKPOINT_CLOSED' | 'CAPACITY_REACHED'
  | 'FORBIDDEN' | 'CHECKPOINT_NOT_FOUND' | 'CLIENT_ID_CONFLICT';
{ code: ScanCode, replayed?: boolean, voided?: boolean,
  participant?: { id, displayName, photoUrl: string | null /*signed, 300 s*/, status, dietaryNotes?: string | null },
  previous?: { scannedAt, scannedByName, scannedByMe: boolean },
  reissued?: boolean, revokeReason?: string, otherEvent?: string, capacity?: number,
  serverTime: string }
```
- `ScanCode` is defined **once** in `lib/domain/scan-codes.ts` and imported by both server and client. The SQL function's codes MUST match; a test asserts the set equality (T-SCAN-23).
- Status codes:
  - `400`: schema invalid.
  - `401`: no session.
  - `429`: rate limited (120 scans/min per staff member, or more than 30 `NOT_FOUND` per staff member in 5 min, §15).
  - `5xx`: the client shows NETWORK/SERVER, never green.
- The handler converts `photoPath` to a signed URL, logs `scan_attempts` (with latency), and never logs the token.

### 9.2 `POST /api/ingest/sheet` (HMAC)

Headers:
- `X-Passline-Timestamp`: unix **seconds**.
- `X-Passline-Signature`: lowercase hex of `HMAC_SHA256(SHEET_INGEST_SECRET, timestamp + "." + rawBody)`.

Verification:
1. Read the raw body with `await req.text()` **before** parsing.
2. Reject with `401` if `|now − ts| > 300 s`.
3. Compare the signature with `crypto.timingSafeEqual`, after checking the lengths match.
4. Reject bodies over 1 MB with `413`.

```ts
// Request
{ event_slug: string, rows: Array<{ external_id: string, email: string, first_name: string,
  last_name?: string, dietary_notes?: string, linkedin_url?: string, status: string }> } // ≤ 500 rows
// 200 Response — same length and order as rows
{ results: Array<{ external_id: string, result: 'CREATED'|'UPDATED'|'UNCHANGED'|'PASS_QUEUED'
  |'REVOKED'|'IGNORED_CLEAR'|'CONFLICT_DUPLICATE_EMAIL'|`INVALID:${string}` }> }
```
Unknown `event_slug` returns `404`. An invalid `linkedin_url` is dropped (set to null) with the row still processed, and `INVALID` is **not** raised for it (DECISION: optional field).

### 9.3 Other endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/pass` | token in body; 30 req/min/IP | Pass page data (F5) |
| `POST /api/pass/photo` | token in multipart | Photo upload (F5) |
| `GET /api/events/:slug/participants/search?q=` | staff | Manual lookup (§10.4) |
| `POST /api/scans/:id/void` | staff | F11 |
| `POST /api/email/drain` | `Authorization: Bearer DRAIN_SECRET` or organizer session | F4 |
| `/api/admin/*` | organizer | Checkpoints, staff, participants, sync, export |

---

## 10. Scanner UI (`/scan/[slug]`)

### 10.1 Layout

- A **checkpoint banner** is always visible at the top. It shows the checkpoint name and a kind color (door = blue, meal = orange, session = purple, custom = teal).
- Changing the checkpoint requires a confirm dialog. The selection is saved to `localStorage` under `passline:checkpoint:<slug>`.
- The camera viewport takes about 60% of the height, below that are the **Manual search** and **Undo last** buttons.
- The scanner abstraction:
  ```ts
  interface QrScanner { start(video: HTMLVideoElement, onDecode: (text: string) => void): Promise<void>;
    stop(): Promise<void>; listCameras(): Promise<MediaDeviceInfo[]> }
  ```
- Camera settings:
  - prefer `facingMode: 'environment'` and remember the chosen `deviceId`,
  - decode at 10 fps or lower,
  - the `<video>` element MUST have `playsinline` and `muted`.
- Request a Screen Wake Lock while scanning where supported, and re-acquire it on `visibilitychange` (§17 A4).

### 10.2 Result screen

Every state needs an icon, a text label and a color, never color alone. Names are at least 32 px, and the photo is at least 160 px.

| Code | Color | Headline | Dismiss |
|------|-------|----------|---------|
| ACCEPTED (door) | green ✓ | **ADMIT** + name + photo | auto 2.5 s |
| ACCEPTED (meal) | green ✓ | **SERVE** + name + dietary notes (bold if present) | auto 2.5 s |
| ACCEPTED (session/custom) | green ✓ | **RECORDED** + name | auto 2.5 s |
| ACCEPTED `replayed` | green ✓ | same as ACCEPTED, "(confirmed)" | auto 2.5 s |
| ALREADY_SCANNED, `scannedByMe` and < 60 s ago | amber ⟳ | "You scanned this 8 s ago" | tap |
| ALREADY_SCANNED otherwise | red ✕ | "ALREADY SCANNED 12:03 PM by Maya": check the photo | tap |
| NOT_FOUND | red ✕ | "UNKNOWN CODE": use manual search | tap |
| REVOKED, reissued | amber ! | "OLD CODE": ask for their newest email | tap |
| REVOKED, not reissued | red ✕ | "PASS CANCELLED": send to organizer | tap |
| NOT_ACCEPTED | red ✕ | "NOT ACCEPTED (waitlisted)" | tap |
| WRONG_EVENT | red ✕ | "This pass is for {otherEvent}" | tap |
| NOT_CHECKED_IN | amber ! | "Not checked in yet": send to entrance | tap |
| CHECKPOINT_CLOSED | amber ! | "{checkpoint} is closed" | tap |
| CAPACITY_REACHED | red ✕ | "FULL ({capacity})" | tap |
| FORBIDDEN / CHECKPOINT_NOT_FOUND | red ✕ | "No access": re-select event | tap → checkpoint picker |
| CLIENT_ID_CONFLICT | amber ! | "Rescan please" | tap |
| MALFORMED (client) | amber ? | "Not a Passline code" | auto 1.5 s |
| NETWORK / 5xx (client) | amber ! | "NO RESULT: do not admit yet. Rescan." | tap |

Rules:
- Only green results auto-dismiss. Every problem requires a tap, so the volunteer notices it.
- **The client MUST NOT show green unless the server returned `ACCEPTED`** (I-1).
- Sounds: a distinct chime for green, a buzz for red, and a double tone for amber.
- `navigator.vibrate` where available. It is not supported on iOS Safari, so never rely on it.
- **Dedupe:** ignore any decode of the same text within 3 s. Pause decoding while a result is shown.
- **Network:** 8 s timeout, then auto-retry up to 2 times with the **same** `clientScanId`, then show NETWORK.
- **Offline:** when `navigator.onLine === false` or a fetch fails at the network level, show a persistent red banner "OFFLINE: use paper list" and disable scanning.

### 10.3 Undo

After a volunteer's own scan, "Undo last" is visible for 120 s. It asks for a reason with quick picks: "Wrong checkpoint", "Wrong person", "Test scan", or Other. The server enforces the time window.

### 10.4 Manual search

- Normalization, `toSearchText(s)`:
  1. Unicode NFKD.
  2. Remove combining marks (`\p{M}`).
  3. Lowercase.
  4. Replace every non-alphanumeric character with a space, collapse spaces, and trim.
  - `search_text = toSearchText(first + ' ' + last)`.
- Query: minimum 2 normalized chars. Match `search_text % q OR search_text LIKE '%' || q || '%'`, order by `similarity` descending, limit 10, same event only.
- Each row shows: name, photo, status badge, email (**masked for volunteers**: `a***@gmail.com`; full for organizers), and whether they already have a live scan at the selected checkpoint.
- "Record scan" calls `/api/scan` with `method: 'manual'`.

---

## 11. Admin UI (`/admin/[slug]`, organizer only)

| Page | Contents |
|------|----------|
| Dashboard | Live counts per checkpoint (10 s poll). Door check-in rate. Meals served vs checked in. Arrivals chart (15-min buckets). Outbox pending/failed. `NOT_FOUND` spike alert. **Warning if within 30 min of `starts_at` and the door is closed.** |
| Participants | Search/filter by status, pass state, photo, scans. Actions: resend pass (confirm: "their old code will stop working"), revoke, add walk-in, mark test, delete (tombstone), view scan history, void a scan. |
| Checkpoints | CRUD, open/close toggle, capacity, requires_checkin, sort order. Deleting a checkpoint with scans is blocked. |
| Staff | Invite by email + role, list, remove. |
| Sync | "Sync now" dry-run diff, then Apply. Last sync time. |
| Export | CSVs: participants, scans (live only, with a voided toggle), per-checkpoint summary. |

---

## 12. Email

- **From:** an address on a domain you control, with SPF and DKIM verified at the provider.
- **Subject:** `You're in: {Event name} — your check-in pass`.
- **HTML body, in this order:**
  1. greeting with first name,
  2. event name,
  3. **local** date and time (`event.timezone`, e.g. "Sat, Oct 3 · 9:00 AM EDT"),
  4. venue,
  5. QR image,
  6. "Open your pass" link (`/p#token`),
  7. tips (turn brightness up; a screenshot is fine; this code is personal),
  8. an optional "Add a photo for faster check-in" link (same pass page),
  9. organizer contact,
  10. privacy line.
- **Plain-text part** includes the pass link and all the facts above.
- **QR image:** embed as an inline attachment referenced by `cid:` if the provider supports it. Otherwise attach it as a normal PNG attachment as well (§17 A1). Do **not** use a `data:` URI, because many clients block them.
- **Escape** all interpolated values. Keep the HTML well under Gmail's ~102 KB clipping threshold.
- **Disable open and click tracking.** Tracking rewrites links, which leaks fragments into redirect logs, and adds pixels.
- **Dev/test:** `EMAIL_PROVIDER=console` writes `.eml`-style output to `./.mail/` and never calls the network.

---

## 13. Analytics definitions

All metrics exclude voided scans, `is_test` participants and deleted participants unless stated. Time buckets use UTC `date_bin` with the event's `starts_at` as origin, and are **labelled** in `event.timezone`. This avoids DST collisions: on 2026-11-01 in Toronto, 01:00–02:00 happens twice.

| Metric | Definition |
|--------|------------|
| Accepted | participants with `status = accepted` |
| Checked in | distinct participants with a live door scan |
| Check-in rate | checked in ÷ accepted |
| No-shows | accepted without a live door scan (list) |
| Meal uptake | live scans at meal M ÷ checked in |
| Session attendance | live scans per session; ranking by count desc, then name asc |
| Session fill | live scans ÷ capacity (if set) |
| Arrival curve | live door scans per 15-min bucket |
| Scan problems | `scan_attempts` grouped by `result_code`, per checkpoint |

```sql
create view v_checkpoint_counts with (security_invoker = true) as
select c.event_id, c.id as checkpoint_id, c.name, c.kind, c.capacity,
       count(s.id) filter (where s.voided_at is null and not p.is_test and p.deleted_at is null) as live_scans
  from checkpoints c
  left join scans s        on s.checkpoint_id = c.id
  left join participants p on p.id = s.participant_id
 group by c.id;

-- Arrivals (parameterized in app code)
select date_bin('15 minutes', s.scanned_at, e.starts_at) as bucket_utc, count(*) as arrivals
  from scans s
  join checkpoints c on c.id = s.checkpoint_id and c.kind = 'door'
  join participants p on p.id = s.participant_id
  join events e on e.id = s.event_id
 where s.event_id = $1 and s.voided_at is null and not p.is_test and p.deleted_at is null
 group by 1 order by 1;

-- v1.1: co-attendance between sessions
select a.checkpoint_id as x, b.checkpoint_id as y, count(*) as both_attended
  from scans a join scans b
    on a.participant_id = b.participant_id and a.checkpoint_id < b.checkpoint_id
 where a.event_id = $1 and a.voided_at is null and b.voided_at is null
 group by 1, 2;
```

**CSV rules** (all exports go through `toCsv()`):
- UTF-8 **with BOM**, so Excel shows accents correctly.
- CRLF line endings, every field quoted, `"` doubled.
- **Formula-injection guard:** any cell starting with `=`, `+`, `-`, `@`, TAB or CR gets a `'` prefix.

---

## 14. Test catalog

**Layers:** **U** = unit (Vitest, no I/O) · **I** = integration (Vitest against local Supabase, real Postgres) · **E** = end-to-end (Playwright) · **M** = manual (checklist before each event).

**Standard fixture** (`tests/fixtures/standard.ts`). Each test file creates its own event with a unique slug:
- Event **E1** has checkpoints:
  - door **D**,
  - meal **L** (`requires_checkin`),
  - session **W** (capacity 2),
  - custom **R** (`requires_checkin = false`).
- Event **E2** has door **D2**.
- Participants in E1:
  - **A**, **B**: accepted, with passes,
  - **C**: waitlisted,
  - **Rv**: pass rotated once, so it has an old token and a new token,
  - **Wd**: withdrawn after acceptance (pass revoked for `status_change`),
  - **T**: `is_test`.
- **X** is accepted in E2.
- Staff:
  - **org1**: organizer on E1,
  - **vol1**, **vol2**: volunteers on E1,
  - **vol3**: volunteer on E2 only.
- All checkpoints start open unless the test says otherwise.

### 14.1 Tokens & QR — `T-TOK`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-TOK-01 | Generate 10,000 tokens | All unique, all 32 chars, all match `^[A-Za-z0-9_-]{32}$` | U |
| T-TOK-02 | Parse `${APP_ORIGIN}/p#<token>` | `{ok:true, token}` | U |
| T-TOK-03 | Parse a bare 32-char token, and one with surrounding whitespace | ok | U |
| T-TOK-04 | Parse another origin, `http:` in prod, `/p?t=`, `/pass#`, a 31/33-char token, `+` or `/` characters, an extra `&x=1` | `MALFORMED`, no throw | U |
| T-TOK-05 | Parse `WIFI:S:x;;`, a vCard, an empty string, a 5 KB string, emoji | `MALFORMED`, no throw | U |
| T-TOK-06 | `sha256hex` known vector (`"abc"` → `ba7816bf…15ad`) | matches | U |
| T-TOK-07 | After a full ingest → email → scan flow, search every text column in every table for the raw token | not found anywhere | I |
| T-TOK-08 | Render a QR PNG and decode it (zxing/jsQR in Node) | decodes to the exact URL; corner pixel opaque white; quiet zone ≥ 4 modules | U |
| T-TOK-09 | Downscale the QR to 25%, re-encode as JPEG q40, decode | still decodes | U |

### 14.2 Sheet ingest — `T-ING`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-ING-01 | Valid signature, fresh timestamp | 200, per-row results | I |
| T-ING-02 | Signature off by one hex char; wrong secret; missing header | 401, zero DB writes | I |
| T-ING-03 | Timestamp 301 s old; 301 s in the future | 401 | I |
| T-ING-04 | Same signed request sent twice | Second response: every row `UNCHANGED`; no duplicate participants, passes or outbox rows | I |
| T-ING-05 | Body with non-ASCII (`Zoë`, `李雷`, `محمد`), signed over the raw UTF-8 bytes | Verifies; names stored byte-exact | I |
| T-ING-06 | New row, `Accepted` | participant accepted + exactly 1 pending outbox row | I |
| T-ING-07 | New rows `Waitlisted` / `Rejected` / blank | participant with that status; no outbox | I |
| T-ING-08 | Waitlisted → Accepted | `PASS_QUEUED` | I |
| T-ING-09 | Accepted → Accepted, nothing changed | `UNCHANGED`; no outbox, no new pass | I |
| T-ING-10 | Accepted → Withdrawn | `REVOKED`; active pass revoked (`status_change`); pending outbox → `cancelled`; existing scans untouched | I |
| T-ING-11 | Withdrawn → Accepted again | new pass queued; old pass stays revoked | I |
| T-ING-12 | Email `" Ade@Gmail.COM "` | stored `ade@gmail.com` | I |
| T-ING-13 | Same `external_id`, new email | email updated, `pass_reissued` queued, `audit_log` row with no PII | I |
| T-ING-14 | New `external_id` with an email already used in the event | `CONFLICT_DUPLICATE_EMAIL`; other rows in the batch still processed | I |
| T-ING-15 | Same email in E1 and E2 | two participants (allowed) | I |
| T-ING-16 | Missing email / first_name / external_id | `INVALID:email` etc.; batch continues | I |
| T-ING-17 | Status `"ACCEPTED "`, `"accepted"`, `"Accepted"` | all normalize; `"Maybe"` → `INVALID:status` | U+I |
| T-ING-18 | Accepted → blank | `IGNORED_CLEAR`; pass still active | I |
| T-ING-19 | Unknown `event_slug` | 404 | I |
| T-ING-20 | 500 rows, all accepted | < 10 s; 500 outbox rows; **zero provider calls during the request** | I |
| T-ING-21 | 501 rows; body > 1 MB | 400; 413 | I |
| T-ING-22 | Names `O'Brien`, `<script>alert(1)</script>`, 100-char name, 101-char name | stored / stored (escaped on render) / stored / `INVALID:first_name` | I |
| T-ING-23 | Invalid `linkedin_url` (`linkedin.com/company/x`, `javascript:`) | row processed, `linkedin_url` null | I |
| T-ING-24 | Same row posted 5× concurrently | 1 participant, 1 in-flight outbox row | I |
| T-ING-25 | Sync-now dry run | returns diff; zero writes (row counts identical before/after) | I |

### 14.3 Apps Script — `T-GAS` (manual, on a copy of the real Sheet)
| ID | Scenario | Expected |
|----|----------|----------|
| T-GAS-01 | Submit the form | `Applicant ID` filled with a UUID within seconds |
| T-GAS-02 | Set one Status to Accepted | `Sync Status` shows `PASS_QUEUED <time>`; email arrives within 5 min |
| T-GAS-03 | Paste Accepted into 30 rows at once | one POST; 30 Sync Status cells filled |
| T-GAS-04 | Edit a non-Status column | no POST (Sync Status unchanged) |
| T-GAS-05 | Edit the header row | no POST |
| T-GAS-06 | Sort the sheet by name, then change a Status | the correct participant changes (keyed by Applicant ID) |
| T-GAS-07 | Insert a column left of Status; add a new form question | still works (header lookup) |
| T-GAS-08 | Point `ENDPOINT` at a dead URL, edit a Status | `ERROR ...` in Sync Status; restore; Sync now reconciles |
| T-GAS-09 | Clear an accepted Status | `IGNORED_CLEAR` |

### 14.4 Email & outbox — `T-MAIL`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-MAIL-01 | Two drainers run concurrently over 50 pending rows | each row sent exactly once (mock provider call count = 50) | I |
| T-MAIL-02 | At provider-call time, look up `sha256(token in email)` | exists in `passes` with `revoked_at IS NULL` (pass committed before send) | I |
| T-MAIL-03 | Provider throws 500 on every attempt | attempts 1..5 with backoff 1 min/5 min/25 min/2 h; then `failed`; `last_error` contains no email address | I |
| T-MAIL-04 | Provider 429 with `Retry-After: 120` | `next_attempt_at ≈ now + 120 s` | I |
| T-MAIL-05 | Drainer claims then "crashes" (never finishes) | row reclaimable after `locked_until` passes | I |
| T-MAIL-06 | Participant withdrawn between enqueue and drain | outbox `cancelled`; no pass issued; no send | I |
| T-MAIL-07 | Rendered email content | contains first name, event name, local time with TZ abbreviation, venue, `cid:` QR (or attachment), `/p#` link, plain-text part | U |
| T-MAIL-08 | First name `<b>x</b>` | appears escaped | U |
| T-MAIL-09 | Rendered HTML size | < 60 KB | U |
| T-MAIL-10 | `EMAIL_PROVIDER=console` | no network call (fetch spy), file written to `.mail/` | U |
| T-MAIL-11 | Organizer resends | new pass active; old token → `REVOKED` + `reissued: true` | I |
| T-MAIL-12 | Real inboxes: Gmail web, Gmail iOS (dark mode), Apple Mail, Outlook web, college email | arrives in inbox (not spam); QR scannable off each screen | M |

### 14.5 Pass page & photo — `T-PASS`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-PASS-01 | Open `/p#<token>` | name, event, QR shown; server request log has no token (the request is `POST /api/pass`, and `/p` is fetched without the fragment) | E |
| T-PASS-02 | Garbage token; valid-format but unknown token | same generic "Pass not found" response body and timing class | I |
| T-PASS-03 | Rotated token; revoked (withdrawn) token | `replaced`; `cancelled` | I |
| T-PASS-04 | Upload a JPEG with GPS EXIF + orientation 6 | output 512×512 JPEG, no EXIF GPS, visually upright (golden image) | I |
| T-PASS-05 | PNG, WebP; 8 MB file; 8 MB + 1 byte | ok, ok, ok, 413 | I |
| T-PASS-06 | PDF renamed `.jpg`; SVG | 415 (magic-byte check) | I |
| T-PASS-07 | Upload after door check-in | 409 `PHOTO_LOCKED` | I |
| T-PASS-08 | Public bucket URL for the photo | 400/403; signed URL works and expires after 300 s | I |
| T-PASS-09 | 11th upload within an hour | 429 | I |
| T-PASS-10 | Real iPhone: pick a HEIC photo from the library | upload succeeds (arrives as JPEG) | M |

### 14.6 Scan decision logic — `T-SCAN` (call `record_scan` directly via SQL and via `/api/scan`)
| ID | Scenario | Expected |
|----|----------|----------|
| T-SCAN-01 | A at D | `ACCEPTED`; 1 live row; `method=qr`; `scanned_at` = server time (± 2 s), unaffected by a client time of 1999 |
| T-SCAN-02 | A at D again | `ALREADY_SCANNED`; `previous.scannedByName`; `scannedByMe` true for same staff, false for vol2 |
| T-SCAN-03 | Random well-formed token | `NOT_FOUND` |
| T-SCAN-04 | Rv old token | `REVOKED`, `reissued: true`, `revokeReason: 'rotated'` |
| T-SCAN-05 | Wd token | `REVOKED`, `reissued: false`, `revokeReason: 'status_change'` |
| T-SCAN-06 | C (waitlisted, via manual since there is no pass) | `NOT_ACCEPTED` |
| T-SCAN-07 | X token at D | `WRONG_EVENT`, `otherEvent` = E2 name, **no participant object** |
| T-SCAN-08 | A at L before door; at D; at L; at L | `NOT_CHECKED_IN`, `ACCEPTED`, `ACCEPTED` (with `dietaryNotes`), `ALREADY_SCANNED` |
| T-SCAN-09 | A at R without door | `ACCEPTED` |
| T-SCAN-10 | Close D; scan B | `CHECKPOINT_CLOSED`; zero rows written |
| T-SCAN-11 | A, B at W (cap 2); then A at W again | third scan → `ALREADY_SCANNED` (**not** `CAPACITY_REACHED`) |
| T-SCAN-12 | A, B at W; new accepted participant N at W | `CAPACITY_REACHED`, `capacity: 2` |
| T-SCAN-13 | Void A at L; scan A at L | `ACCEPTED`; exactly one live and one voided row |
| T-SCAN-14 | Void B at W; N at W | `ACCEPTED` (voided scans free capacity) |
| T-SCAN-15 | Void A's door scan after lunch | lunch scan remains live (no cascade) |
| T-SCAN-16 | vol3 scans at D | `FORBIDDEN` |
| T-SCAN-17 | Remove vol1 from event staff; vol1 scans | `FORBIDDEN` on the very next call |
| T-SCAN-18 | Manual path for cases 01, 02, 06, 08 | same codes; `method=manual`, `pass_id` null |
| T-SCAN-19 | `dietaryNotes` present at L; absent (undefined/null) at D, W, R | as stated |
| T-SCAN-20 | Same `clientScanId` sent twice by vol1 | both `ACCEPTED`, second `replayed: true`; 1 row |
| T-SCAN-21 | Same `clientScanId` reused by vol2 | `CLIENT_ID_CONFLICT`; no new row |
| T-SCAN-22 | Raw SQL insert of a scan joining E2 participant X to E1 checkpoint D | FK violation |
| T-SCAN-23 | Set of codes the SQL function can return (grep function source) == `ScanCode` union | equal |
| T-SCAN-24 | `select record_scan(...)` as `anon` and as `authenticated` | permission denied |
| T-SCAN-25 | Precedence: X's **revoked** old token at D | `REVOKED` (step 5 before step 6) |
| T-SCAN-26 | Precedence: C at a **closed** checkpoint | `NOT_ACCEPTED` (step 7 before step 8) |
| T-SCAN-27 | Deleted participant: old token → ; manual by id → | `REVOKED` (`deleted`); `NOT_FOUND` |
| T-SCAN-28 | Volunteer voids own scan at 119 s; at 121 s; voids vol2's scan | `VOIDED`; `FORBIDDEN`; `FORBIDDEN` (organizer: all `VOIDED`) |
| T-SCAN-29 | Void without reason / reason "ok" (2 chars) | 400 / 400 |

### 14.7 Concurrency — `T-CONC` (MUST use truly parallel connections, e.g. a `pg.Pool` of size ≥ N with `Promise.all`; never sequential awaits)
| ID | Scenario | Expected |
|----|----------|----------|
| T-CONC-01 | 50 parallel scans of A at D, distinct `clientScanId`s | exactly 1 `ACCEPTED`, 49 `ALREADY_SCANNED`; 1 live row |
| T-CONC-02 | 20 parallel scans with the **same** `clientScanId` | 20 × `ACCEPTED` (19 replayed); 1 row |
| T-CONC-03 | Capacity 10; 30 distinct participants in parallel | exactly 10 `ACCEPTED`, 20 `CAPACITY_REACHED` |
| T-CONC-04 | 10 parallel `issue_pass` for A (who already has 1 pass) | exactly 1 active pass; 11 rows total, 10 revoked `rotated` |
| T-CONC-05 | Parallel scan of A at L while the door scan is being voided | no deadlock/error; outcome is either `ACCEPTED` or `NOT_CHECKED_IN`; completes < 2 s |
| T-CONC-06 | W at capacity − 1; A scanned twice in parallel at W | 1 `ACCEPTED` + 1 `ALREADY_SCANNED` (never `CAPACITY_REACHED`) |
| T-CONC-07 | Loop T-CONC-01, -02 and -03 100× in CI nightly | 0 failures (flake = bug). T-CONC-02 caught a real race in this spec's first draft: it fails ~5% of runs without the step-10 replay check |

### 14.8 Scanner UI — `T-SCUI` (Playwright; Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=tests/assets/<qr>.y4m`)
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-SCUI-01 | Fake camera shows A's QR | ADMIT screen < 1.5 s after page ready | E |
| T-SCUI-02 | Same QR stays in frame for 10 s | exactly 1 `/api/scan` request (route interception count) | E |
| T-SCUI-03 | Each `ScanCode` stubbed via route interception | correct color, icon, text label, dismiss rule per §10.2 (screenshot + DOM assertions) | E |
| T-SCUI-04 | `/api/scan` hangs | 2 retries with the same `clientScanId` (assert request bodies), then NETWORK screen; never green | E |
| T-SCUI-05 | `context.setOffline(true)` | OFFLINE banner; scanning disabled; manual scan disabled | E |
| T-SCUI-06 | QR encoding `https://example.com` | "Not a Passline code"; zero `/api/scan` requests | E |
| T-SCUI-07 | Change checkpoint | confirm dialog; banner updates; persisted after reload | E |
| T-SCUI-08 | Camera permission denied | instructions shown; manual search usable | E |
| T-SCUI-09 | Undo visible at 0–120 s, hidden after (fake timers) | as stated | E |
| T-SCUI-10 | Session expired mid-shift | redirect to login, then back to the same slug + checkpoint | E |
| T-SCUI-11 | `<video>` has `playsinline` and `muted` | yes | E |
| T-SCUI-12 | ALREADY_SCANNED with `scannedByMe` 8 s ago vs 90 s ago vs by vol2 | amber vs red vs red | E |
| T-SCUI-13 | Device matrix (§14.13) | all pass | M |

### 14.9 Manual search — `T-SRCH`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-SRCH-01 | `toSearchText("Zoë O'Brien-Smith")` | `"zoe o brien smith"` | U |
| T-SRCH-02 | Query `zoe`; `obrien`; `ade` (matching Adebayo); `李` | finds each | I |
| T-SRCH-03 | Query of 1 char | 400 | I |
| T-SRCH-04 | 30 matching names | 10 results | I |
| T-SRCH-05 | Name in E2 only, searched from E1 | not returned | I |
| T-SRCH-06 | Volunteer vs organizer | masked vs full email | I |
| T-SRCH-07 | Result shows scan state at the selected checkpoint | yes | E |

### 14.10 Admin — `T-ADM`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-ADM-01 | Volunteer requests every `/admin/*` page and `/api/admin/*` route | 403 server-side | I+E |
| T-ADM-02 | Toggle checkpoint open → scan → close → scan | applies on the very next scan | I |
| T-ADM-03 | Add walk-in with "check in now" | participant `walk_in`, live manual door scan | I |
| T-ADM-04 | Delete a checkpoint that has scans | blocked with message | I |
| T-ADM-05 | Delete participant | tombstone per §5.1; counts unchanged; token → `REVOKED` | I |
| T-ADM-06 | Door closed, now = `starts_at − 20 min` | dashboard warning visible | E |
| T-ADM-07 | 31 `NOT_FOUND` from vol1 in 5 min | 429 for vol1; alert on dashboard | I |

### 14.11 Analytics & export — `T-ANA`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-ANA-01 | Golden fixture with a hand-computed expected JSON | every dashboard number equals the expected value | I |
| T-ANA-02 | Voided, `is_test` and deleted participants in the fixture | excluded from every metric | I |
| T-ANA-03 | Event spanning 2026-10-31 22:00 → 2026-11-01 04:00 America/Toronto | 01:00–02:00 appears as **two** distinct buckets labelled EDT and EST | I |
| T-ANA-04 | `toCsv` with `=SUM(A1)`, `+1`, `-1`, `@x`, `"quoted"`, `a,b`, newline | guarded/escaped per §13; starts with BOM; CRLF | U |
| T-ANA-05 | Export as volunteer | 403 | I |
| T-ANA-06 | Session ranking tie | sorted by name asc | I |

### 14.12 Security & privacy — `T-SEC`, `T-PRIV`
| ID | Scenario | Expected | L |
|----|----------|----------|---|
| T-SEC-01 | For **every** table in `public` (enumerated from `pg_tables`): select/insert/update/delete with the anon key and with an authenticated user JWT | denied or 0 rows | I |
| T-SEC-02 | `pg_tables.rowsecurity` for every public table | all true | I |
| T-SEC-03 | After `next build`, grep `.next/static` for `SERVICE_ROLE` and the key's value | not found | CI |
| T-SEC-04 | Enumerate every route handler file; call each unauthenticated | 401 (except `/api/pass*`, `/api/ingest/sheet`, `/api/email/drain` with their own auth) | I |
| T-SEC-05 | Capture server logs during the full e2e flow | contain no token, no email, no participant name | E |
| T-SEC-06 | Response headers | CSP present; `frame-ancestors 'none'`; `Permissions-Policy: camera=(self)`; HSTS in prod | E |
| T-SEC-07 | Every view | `security_invoker = true`; no grant to anon/authenticated | I |
| T-SEC-08 | Every `SECURITY DEFINER` function in `public` | `proconfig` contains `search_path`; no EXECUTE for anon/authenticated/PUBLIC | I |
| T-PRIV-01 | Retention job at `ends_at + 30 d` | photos deleted from storage, `photo_path` null, `dietary_notes` null | I |
| T-PRIV-02 | Retention job run twice | idempotent | I |
| T-PRIV-03 | `audit_log.detail` after the full e2e flow | contains no email, name or token | I |

### 14.13 Device & venue matrix — `T-DEV` (manual, before every event)

Run all combinations of these **scanners** against these **codes**. Record each result as pass/fail with the time to result.

Scanners:
- iPhone Safari (current iOS and one version back)
- Android Chrome (a recent phone and a cheap or old one)

Codes:
- email on a phone at 100% brightness
- the same at 30% brightness
- a screenshot in the Photos app
- a printed code on paper
- a code with about 10% covered by tape (tests ECC M)
- a code shown in Gmail iOS dark mode

Conditions:
- bright window light
- dim room

Target: at least 95% of attempts under 3 s.

### 14.14 Performance — `T-PERF`
| ID | Scenario | Expected |
|----|----------|----------|
| T-PERF-01 | Load test against a preview deployment: 5 virtual scanners, 300 scans in 10 min, seeded 500 participants | `/api/scan` p95 < 700 ms, 0 errors |
| T-PERF-02 | Dashboard with 1,000 participants and 5,000 scans | first render < 2 s; poll query < 200 ms |

---

## 15. Non-functional requirements

- **Latency:** `/api/scan` p95 under 700 ms server-side. The Vercel function region MUST be co-located with the Supabase region.
- **Capacity:** 5 concurrent scanners and a 300-person peak arrival within 10 minutes.
- **Rate limits** (Postgres-backed `rate_limits`; never in-memory, because serverless instances do not share memory):

  | Scope | Limit |
  |-------|-------|
  | Scans per staff | 120 / min |
  | `NOT_FOUND` per staff | 30 / 5 min → 429 + alert |
  | `/api/pass` per IP | 30 / min |
  | Photo uploads per pass | 10 / h |
- **Browsers:** iOS Safari (current and previous major version) and Chrome for Android (last two versions). Desktop Chrome, Safari and Firefox for admin.
- **Accessibility:**
  - WCAG 2.1 AA contrast,
  - status never conveyed by color alone,
  - tap targets at least 44×44 px,
  - the scanner is usable one-handed.
- **Privacy:**
  - The Google Form MUST include a collection notice covering what is collected, why (event admission, food, attendance analytics), who sees it (club organizers and volunteers), and retention.
  - Follow the college's student-organization data policies.
  - Retention: photos and dietary notes are deleted 30 days after the event; participant PII 12 months after; aggregate stats are kept.
  - Deletion requests are handled through the admin tombstone.
- **Logging:**
  - Structured JSON logs.
  - Allowed fields: `participant_id`, `event_id`, `checkpoint_id`, `result_code`, `latency_ms`.
  - Never names, emails, tokens, dietary notes or photos.

---

## 16. Event-day runbook

**T − 7 days**
- Full dry run with 10 club members as fake participants on the production deployment, with `is_test = true`.
- Run T-DEV and T-MAIL-12.
- Confirm SPF/DKIM pass: check "Show original" in Gmail.

**T − 1 day**
- Create checkpoints, all closed.
- Invite staff; every volunteer signs in once on their own phone and runs a test scan.
- Export and **print the accepted roster** (name, checkbox per checkpoint) as the offline fallback.
- Check the dashboard: outbox has 0 failed and 0 pending.
- Charge phones and bring battery packs.

**Doors (T − 30 min)**
- Open the door checkpoint.
- Each station scans a test pass and confirms the dashboard counter moves.
- Void the test scans.

**During**

| Situation | Action |
|-----------|--------|
| Code won't scan | Manual search → Record scan |
| `NOT_FOUND` | Manual search by name; check for an email typo in the Sheet; organizer adds a walk-in if they're legit |
| `REVOKED` + reissued | Ask them to open their **newest** email; organizer can resend on the spot |
| `ALREADY_SCANNED` by someone else | Compare the photo; escalate to an organizer |
| `WRONG_EVENT` | Organizer decides |
| Network down | Switch to the paper roster; after recovery, an organizer enters paper check-ins through manual scan |
| Wrong checkpoint used by a volunteer | Volunteer voids within 120 s; otherwise an organizer voids with reason "Wrong checkpoint" |

**After**
- Close all checkpoints.
- Export CSVs.
- Put the retention date in the calendar.
- Run the post-event review: `scan_attempts` problems grouped by code.

---

## 17. Assumptions to verify (before or during the relevant slice)

| # | Assumption | If false |
|---|-----------|----------|
| A1 | Resend supports inline (`cid:`) attachments and an idempotency-key header | Attach the QR as a regular PNG and rely on the outbox for dedupe |
| A2 | Installable `onEdit` fires once for a multi-cell paste with the full range, and does not fire for script/API edits | Adjust the script; Sync now remains the backstop |
| A3 | iOS Safari hands the page a JPEG when `accept` excludes HEIC | Add server-side HEIC handling or instruct users |
| A4 | Screen Wake Lock API available on target iOS/Android versions | Instruct volunteers to extend auto-lock |
| A5 | Vercel plan limits (function duration, cron frequency) and Supabase `pg_cron` + `pg_net` availability fit the F4 drain | Pick whichever scheduler is available; the `after()` + button path still works |
| A6 | The provider's rate limit handles bursts of about 300 sends | Throttle the drain batch size |
| A7 | Scanner library choice: compare html5-qrcode, nimiq `qr-scanner` and `@zxing/browser` on iOS reliability, bundle size and maintenance activity | Swap behind the `QrScanner` interface |
| A8 | `Utilities.computeHmacSha256Signature(value, key, Utilities.Charset.UTF_8)` output matches Node's HMAC for non-ASCII bodies | T-ING-05 catches it; fix encoding on one side |
| A9 | Supabase region near Toronto | Choose the nearest and co-locate the Vercel functions |

---

## 18. Build plan (vertical slices)

Each slice ends with its tests green in CI and a short demo.

| Slice | Scope | Exit criteria |
|-------|-------|---------------|
| **S0** Tooling | Next.js TS strict, pnpm, ESLint, Vitest, Playwright, Supabase local, `.env.example`, GitHub Actions (lint, typecheck, unit, integration with `supabase start`) | CI green on an empty app |
| **S1** Core DB | §5 schema, `issue_pass`, `record_scan`, `void_scan`, deny-all RLS, fixtures | T-SCAN-*, T-CONC-*, T-SEC-01/02/07/08 |
| **S2** Passes & email | tokens, QR render, outbox, drainer, console mailer, templates | T-TOK-*, T-MAIL-01..11 |
| **S3** Sheet bridge | ingest endpoint, transitions, Apps Script, Sync now | T-ING-*, T-GAS-* |
| **S4** Pass page | `/p`, `/api/pass`, photo pipeline, storage | T-PASS-* |
| **S5** Scanner | staff auth + invites, `/scan`, result UI, manual search, undo | T-SCUI-*, T-SRCH-*, T-SEC-04 |
| **S6** Admin | dashboard, participants, checkpoints, staff, export | T-ADM-*, T-ANA-* |
| **S7** Hardening | headers, rate limits, retention, load test, device matrix, dry run | T-SEC-03/05/06, T-PRIV-*, T-PERF-*, T-DEV, T-MAIL-12 |

---

## 19. Environment variables

| Name | Where | Notes |
|------|-------|-------|
| `NEXT_PUBLIC_APP_ORIGIN` | client+server | e.g. `https://passline.example.com`; used in QR payload + parser |
| `NEXT_PUBLIC_SUPABASE_URL` | client+server | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | Auth only; tables are deny-all |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Never imported from client code |
| `SHEET_INGEST_SECRET` | server + Apps Script property | ≥ 32 random bytes |
| `DRAIN_SECRET` | server + scheduler | |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | server | Sync now (read-only Sheets scope) |
| `EMAIL_PROVIDER` | server | `console` \| `resend` |
| `RESEND_API_KEY`, `EMAIL_FROM` | server | |

---

## 20. Changelog
- **v0.1 (2026-09-23)** — Initial draft.

---

## Appendix A — Apps Script (`apps-script/Code.gs`)

**Setup**
1. In the Sheet, open **Extensions → Apps Script** and paste this file.
2. Under **Project Settings → Script properties**, set `ENDPOINT`, `EVENT_SLUG` and `INGEST_SECRET`.
3. Under **Triggers**, add:
   - `onFormSubmitInstalled`: *From spreadsheet → On form submit*,
   - `onEditInstalled`: *From spreadsheet → On edit*.
4. Add the headers `Applicant ID`, `Status` and `Sync Status`. Put data validation on `Status`.

```javascript
const SHEET_NAME = 'Form Responses 1';
const HEADERS = {
  id: 'Applicant ID', email: 'Email Address', first: 'First Name', last: 'Last Name',
  dietary: 'Dietary Restrictions', linkedin: 'LinkedIn URL', status: 'Status', sync: 'Sync Status',
};
const REQUIRED = ['id', 'email', 'first', 'status', 'sync'];

function prop_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing script property ' + k);
  return v;
}

function headerMap_(sheet) {
  const row = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const byName = {};
  row.forEach((h, i) => { byName[String(h).trim()] = i + 1; });
  const cols = {};
  Object.keys(HEADERS).forEach(k => { cols[k] = byName[HEADERS[k]] || 0; });
  REQUIRED.forEach(k => { if (!cols[k]) throw new Error('Missing header: ' + HEADERS[k]); });
  return cols;
}

function onFormSubmitInstalled(e) {
  const sheet = e.range.getSheet();
  const cols = headerMap_(sheet);
  const cell = sheet.getRange(e.range.getRow(), cols.id);
  if (!cell.getValue()) cell.setValue(Utilities.getUuid());
}

function onEditInstalled(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;
  const cols = headerMap_(sheet);
  const r = e.range;
  if (cols.status < r.getColumn() || cols.status > r.getLastColumn()) return;
  const first = Math.max(r.getRow(), 2);          // skip header row
  const last = r.getLastRow();
  if (last < first) return;
  syncRows_(sheet, cols, first, last);
}

function syncRows_(sheet, cols, first, last) {
  const values = sheet.getRange(first, 1, last - first + 1, sheet.getLastColumn()).getValues();
  const get = (v, k) => (cols[k] ? String(v[cols[k] - 1]).trim() : '');
  const rows = values.map(v => ({
    external_id: get(v, 'id'), email: get(v, 'email'), first_name: get(v, 'first'),
    last_name: get(v, 'last'), dietary_notes: get(v, 'dietary'),
    linkedin_url: get(v, 'linkedin'), status: get(v, 'status'),
  }));
  const body = JSON.stringify({ event_slug: prop_('EVENT_SLUG'), rows: rows });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = hex_(Utilities.computeHmacSha256Signature(ts + '.' + body, prop_('INGEST_SECRET'),
                                                         Utilities.Charset.UTF_8));
  let out;
  try {
    const res = UrlFetchApp.fetch(prop_('ENDPOINT'), {
      method: 'post', contentType: 'application/json; charset=utf-8', payload: body,
      headers: { 'X-Passline-Timestamp': ts, 'X-Passline-Signature': sig },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const stamp = new Date().toISOString();
    out = code === 200
      ? JSON.parse(res.getContentText()).results.map(x => [x.result + ' ' + stamp])
      : rows.map(() => ['ERROR HTTP ' + code + ' ' + stamp]);
  } catch (err) {
    out = rows.map(() => ['ERROR ' + String(err).slice(0, 80)]);
  }
  sheet.getRange(first, cols.sync, out.length, 1).setValues(out); // script edits don't re-fire onEdit
}

function hex_(bytes) {
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}
```

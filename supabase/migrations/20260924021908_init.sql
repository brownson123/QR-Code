-- SPEC §5 data model. Deviations from the reference, both deliberate:
--   * pg_trgm lives in the `extensions` schema so its helper functions never land in `public`
--     (T-SEC-08 would otherwise find ~40 PUBLIC-executable functions there).
--   * Table privileges are revoked from anon/authenticated on top of deny-all RLS (I-5, I-6).

create extension if not exists pgcrypto with schema extensions;  -- gen_random_uuid() is also core in PG13+
create extension if not exists pg_trgm with schema extensions;   -- fuzzy name search

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
create index event_staff_user on event_staff (user_id);

-- Organizers invite by email; consumed on first sign-in (§7 F9).
create table staff_invites (
  event_id uuid not null references events on delete cascade,
  email    text not null check (email = lower(btrim(email))),
  role     staff_role not null,
  primary key (event_id, email)
);
create index staff_invites_email on staff_invites (email);

create table participants (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events on delete cascade,
  external_id      text,
  email            text not null check (email = lower(btrim(email))),
  first_name       text not null check (length(first_name) between 1 and 100),
  last_name        text not null default '' check (length(last_name) <= 100),
  search_text      text not null,
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
  unique (id, event_id),
  unique (event_id, external_id),
  unique (event_id, email)
);
create index participants_search_trgm on participants using gin (search_text extensions.gin_trgm_ops);

create table passes (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants on delete cascade,
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
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
  is_open          boolean not null default false,
  starts_at        timestamptz,
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
  foreign key (participant_id, event_id) references participants (id, event_id),
  foreign key (checkpoint_id,  event_id) references checkpoints  (id, event_id),
  check ((method = 'qr') = (pass_id is not null)),
  check ((voided_at is null) = (voided_by is null)),
  check ((voided_at is null) = (void_reason is null))
);
create unique index scans_one_live       on scans (participant_id, checkpoint_id) where voided_at is null;
create index        scans_checkpoint_time on scans (checkpoint_id, scanned_at)    where voided_at is null;
create index        scans_event          on scans (event_id);

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
  action        text not null,
  subject_id    uuid,
  detail        jsonb not null default '{}', -- MUST NOT contain names, emails or tokens (I-11)
  created_at    timestamptz not null default now()
);

create table rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);

-- Deny-all RLS on every table in public. Later migrations enable it per table (T-SEC-02 enforces).
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Defense in depth: the browser never touches tables (I-5), so anon/authenticated need no privileges.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- S6a: organizer operations (SPEC §11, F9, F11, F12, §5.1) and analytics (§13).
-- Every function: SECURITY DEFINER, search_path pinned, EXECUTE only for service_role (I-6).
-- Every function takes the event id and scopes by it, so one event can never touch another's rows.

-- §13 view, verbatim. security_invoker so it can never bypass RLS for another role (T-SEC-07).
create view v_checkpoint_counts with (security_invoker = true) as
select c.event_id, c.id as checkpoint_id, c.name, c.kind, c.capacity,
       count(s.id) filter (where s.voided_at is null and not p.is_test and p.deleted_at is null) as live_scans
  from checkpoints c
  left join scans s        on s.checkpoint_id = c.id
  left join participants p on p.id = s.participant_id
 group by c.id;
revoke all on v_checkpoint_counts from anon, authenticated;

-- §13 metrics in one round trip. Excludes voided scans, is_test and deleted participants everywhere.
-- Ratios are derived in the app; this returns counts.
create or replace function public.event_metrics(p_event_id uuid, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with ev as (select * from events where id = p_event_id),
  eligible as (
    select * from participants where event_id = p_event_id and not is_test and deleted_at is null
  ),
  live as (
    select s.* from scans s join eligible p on p.id = s.participant_id
     where s.event_id = p_event_id and s.voided_at is null
  ),
  door_live as (
    select l.* from live l join checkpoints d on d.id = l.checkpoint_id and d.kind = 'door'
  ),
  checked as (select distinct participant_id from door_live)
  select jsonb_build_object(
    'accepted',  (select count(*) from eligible where status = 'accepted'),
    'checkedIn', (select count(*) from checked),
    'noShows',   (select count(*) from eligible e
                   where e.status = 'accepted' and not exists (select 1 from checked c where c.participant_id = e.id)),
    'checkpoints', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'kind', c.kind, 'isOpen', c.is_open, 'capacity', c.capacity,
               'requiresCheckin', c.requires_checkin, 'sortOrder', c.sort_order, 'liveScans', v.live_scans)
             order by c.sort_order, c.name)
        from checkpoints c join v_checkpoint_counts v on v.checkpoint_id = c.id
       where c.event_id = p_event_id), '[]'::jsonb),
    -- UTC buckets anchored on starts_at; labelled in the event timezone by the app (DST-safe).
    'arrivals', coalesce((
      select jsonb_agg(jsonb_build_object('bucketUtc', b.bucket, 'arrivals', b.n) order by b.bucket)
        from (select date_bin('15 minutes', d.scanned_at, (select starts_at from ev)) as bucket, count(*) as n
                from door_live d group by 1) b), '[]'::jsonb),
    'outbox', (
      select jsonb_build_object(
               'pending', count(*) filter (where o.status in ('pending', 'sending')),
               'failed',  count(*) filter (where o.status = 'failed'))
        from email_outbox o join participants p on p.id = o.participant_id
       where p.event_id = p_event_id),
    -- §15 / T-ADM-07: staff with ≥ 30 NOT_FOUND in the last 5 minutes (the 429 threshold).
    'notFound', coalesce((
      select jsonb_agg(jsonb_build_object('staffUserId', a.staff_user_id, 'displayName', sp.display_name, 'count', a.n)
             order by a.n desc)
        from (select staff_user_id, count(*) as n from scan_attempts
               where event_id = p_event_id and result_code = 'NOT_FOUND' and created_at > p_now - interval '5 minutes'
               group by 1 having count(*) >= 30) a
        left join staff_profiles sp on sp.user_id = a.staff_user_id), '[]'::jsonb),
    'scanProblems', coalesce((
      select jsonb_agg(jsonb_build_object('checkpointId', checkpoint_id, 'code', result_code, 'count', n) order by n desc)
        from (select checkpoint_id, result_code, count(*) as n from scan_attempts
               where event_id = p_event_id and result_code <> 'ACCEPTED' group by 1, 2) x), '[]'::jsonb)
  )
$$;
revoke all on function public.event_metrics(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.event_metrics(uuid, timestamptz) to service_role;

-- F12 walk-in. The optional door check-in goes through record_scan() like every scan (I-2).
create or replace function public.add_walk_in(
  p_event_id uuid, p_organizer_id uuid, p_email text, p_first_name text, p_last_name text, p_search_text text,
  p_check_in boolean, p_send_pass boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid; door_id uuid; scan jsonb;
begin
  begin
    insert into participants (event_id, email, first_name, last_name, search_text, status, source)
    values (p_event_id, p_email, p_first_name, p_last_name, p_search_text, 'accepted', 'walk_in')
    returning id into new_id;
  exception when unique_violation then
    return jsonb_build_object('code', 'CONFLICT_DUPLICATE_EMAIL');
  end;
  if p_send_pass then
    insert into email_outbox (participant_id, kind) values (new_id, 'pass_issued');
  end if;
  if p_check_in then
    select id into door_id from checkpoints where event_id = p_event_id and kind = 'door';
    scan := case when door_id is null then jsonb_build_object('code', 'CHECKPOINT_NOT_FOUND')
                 else record_scan(door_id, p_organizer_id, 'manual', null, new_id, gen_random_uuid(), now()) end;
  end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_organizer_id, 'staff', 'participant.walk_in', new_id);
  return jsonb_build_object('code', 'CREATED', 'participantId', new_id, 'scan', scan);
end $$;
revoke all on function public.add_walk_in(uuid, uuid, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.add_walk_in(uuid, uuid, text, text, text, text, boolean, boolean) to service_role;

-- §5.1 tombstone. Scans stay (aggregate counts stay correct); PII is erased; the pass is revoked.
-- external_id is kept so a later Sheet sync keeps ignoring this row (S3 decision).
create or replace function public.delete_participant(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype;
begin
  select * into pa from participants where id = p_participant_id and event_id = p_event_id for update;
  if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if pa.deleted_at is not null then return jsonb_build_object('code', 'ALREADY_DELETED'); end if;
  update participants
     set deleted_at = now(), first_name = 'Deleted', last_name = '', email = 'deleted+' || id || '@invalid',
         search_text = '', dietary_notes = null, linkedin_url = null, photo_path = null, photo_updated_at = null,
         updated_at = now()
   where id = pa.id;
  update passes set revoked_at = now(), revoke_reason = 'deleted' where participant_id = pa.id and revoked_at is null;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = pa.id and status in ('pending', 'sending');
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'participant.delete', pa.id);
  return jsonb_build_object('code', 'DELETED', 'photoPath', pa.photo_path);
end $$;
revoke all on function public.delete_participant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_participant(uuid, uuid, uuid) to service_role;

-- §11 Resend: queue a new pass email (rotation revokes the old code when it is sent, §6.3).
create or replace function public.enqueue_pass(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype; queued uuid;
begin
  select * into pa from participants where id = p_participant_id and event_id = p_event_id and deleted_at is null;
  if not found then return 'NOT_FOUND'; end if;
  if pa.status <> 'accepted' then return 'NOT_ACCEPTED'; end if;
  insert into email_outbox (participant_id, kind) values (pa.id, 'pass_reissued')
  on conflict (participant_id) where status in ('pending', 'sending') do nothing
  returning id into queued;
  if queued is null then return 'IN_FLIGHT'; end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'pass.resend', pa.id);
  return 'QUEUED';
end $$;
revoke all on function public.enqueue_pass(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_pass(uuid, uuid, uuid) to service_role;

-- §11 Revoke (reason 'manual'): the active pass stops working and nothing in flight is sent.
create or replace function public.revoke_pass(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from participants where id = p_participant_id and event_id = p_event_id for update;
  if not found then return 'NOT_FOUND'; end if;
  update passes set revoked_at = now(), revoke_reason = 'manual' where participant_id = p_participant_id and revoked_at is null;
  if not found then return 'NO_ACTIVE_PASS'; end if;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = p_participant_id and status in ('pending', 'sending');
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'pass.revoke', p_participant_id);
  return 'REVOKED';
end $$;
revoke all on function public.revoke_pass(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_pass(uuid, uuid, uuid) to service_role;

-- T-ADM-04: a checkpoint with scans can't be deleted (the scans FK enforces it). Diagnostic
-- scan_attempts rows are detached so they don't block deleting an unused checkpoint.
create or replace function public.delete_checkpoint(p_event_id uuid, p_checkpoint_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from checkpoints where id = p_checkpoint_id and event_id = p_event_id for update;
  if not found then return 'NOT_FOUND'; end if;
  if exists (select 1 from scans where checkpoint_id = p_checkpoint_id) then return 'HAS_SCANS'; end if;
  begin
    update scan_attempts set checkpoint_id = null where checkpoint_id = p_checkpoint_id;
    delete from checkpoints where id = p_checkpoint_id;
  exception when foreign_key_violation then
    return 'HAS_SCANS'; -- a scan landed concurrently
  end;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'checkpoint.delete', p_checkpoint_id);
  return 'DELETED';
end $$;
revoke all on function public.delete_checkpoint(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_checkpoint(uuid, uuid, uuid) to service_role;

-- F9 invite. Someone who already has an account won't sign in again to consume an invite, so they
-- are added directly; anyone else gets an invite consumed on first sign-in.
create or replace function public.invite_staff(p_event_id uuid, p_email text, p_role staff_role, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; email_norm text := lower(btrim(p_email)); result text;
begin
  select id into uid from auth.users where lower(email) = email_norm limit 1;
  if uid is not null then
    insert into event_staff (event_id, user_id, role) values (p_event_id, uid, p_role)
    on conflict (event_id, user_id) do update set role = excluded.role;
    result := 'ADDED';
  else
    insert into staff_invites (event_id, email, role) values (p_event_id, email_norm, p_role)
    on conflict (event_id, email) do update set role = excluded.role;
    result := 'INVITED';
  end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (p_event_id, p_actor, 'staff', 'staff.invite', uid, jsonb_build_object('role', p_role, 'result', result));
  return result;
end $$;
revoke all on function public.invite_staff(uuid, text, staff_role, uuid) from public, anon, authenticated;
grant execute on function public.invite_staff(uuid, text, staff_role, uuid) to service_role;

-- F9 removal. Serialized per event so two organizers can't remove each other at the same time and
-- leave the event with none.
create or replace function public.remove_staff(p_event_id uuid, p_user_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare target staff_role;
begin
  perform 1 from events where id = p_event_id for update;
  select role into target from event_staff where event_id = p_event_id and user_id = p_user_id;
  if not found then return 'NOT_FOUND'; end if;
  if target = 'organizer' and (select count(*) from event_staff where event_id = p_event_id and role = 'organizer') = 1 then
    return 'LAST_ORGANIZER';
  end if;
  delete from event_staff where event_id = p_event_id and user_id = p_user_id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'staff.remove', p_user_id);
  return 'REMOVED';
end $$;
revoke all on function public.remove_staff(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_staff(uuid, uuid, uuid) to service_role;

-- §11 participants table: filters, pass state and scan counts in one query.
create or replace function public.admin_participants(
  p_event_id uuid, p_status participant_status default null, p_query text default null, p_no_show boolean default false
) returns table (
  id uuid, first_name text, last_name text, email text, status participant_status, source text, is_test boolean,
  external_id text, dietary_notes text, photo_path text, photo_updated_at timestamptz, pass_state text,
  live_scans int, checked_in boolean, created_at timestamptz
) language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.first_name, p.last_name, p.email, p.status, p.source, p.is_test, p.external_id, p.dietary_notes,
         p.photo_path, p.photo_updated_at,
         case when exists (select 1 from passes ps where ps.participant_id = p.id and ps.revoked_at is null) then 'active'
              when exists (select 1 from passes ps where ps.participant_id = p.id) then 'revoked'
              else 'none' end as pass_state,
         (select count(*)::int from scans s where s.participant_id = p.id and s.voided_at is null) as live_scans,
         exists (select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
                  where s.participant_id = p.id and c.kind = 'door' and s.voided_at is null) as checked_in,
         p.created_at
    from participants p
   where p.event_id = p_event_id
     and p.deleted_at is null
     and (p_status is null or p.status = p_status)
     and (p_query is null or p.search_text like '%' || p_query || '%' or p.email like '%' || p_query || '%')
     and (not p_no_show or (p.status = 'accepted' and not p.is_test and not exists (
            select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
             where s.participant_id = p.id and c.kind = 'door' and s.voided_at is null)))
   order by p.last_name, p.first_name, p.id
   limit 1000
$$;
revoke all on function public.admin_participants(uuid, participant_status, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_participants(uuid, participant_status, text, boolean) to service_role;

-- SPEC §6.3 issue_pass and §8 record_scan (reference implementation, verbatim), plus void_scan (F11).
-- Grants per I-6: revoke from public, anon, authenticated; grant to service_role only.

-- §6.3 -------------------------------------------------------------------------------------------
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

-- §8 ---------------------------------------------------------------------------------------------
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

-- F11 void ---------------------------------------------------------------------------------------
-- VOIDED | NOT_FOUND | FORBIDDEN (not staff; or a volunteer voiding someone else's scan, or one
-- older than 120 s) | ALREADY_VOIDED. The reason is stored on the scan, never in audit_log (I-11).
create or replace function public.void_scan(p_scan_id uuid, p_staff_user_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s scans%rowtype; r staff_role;
begin
  select * into s from scans where id = p_scan_id for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;

  select role into r from event_staff where event_id = s.event_id and user_id = p_staff_user_id;
  if not found then return jsonb_build_object('code','FORBIDDEN'); end if;

  if s.voided_at is not null then return jsonb_build_object('code','ALREADY_VOIDED'); end if;

  if r <> 'organizer' and (s.scanned_by <> p_staff_user_id or now() - s.scanned_at > interval '120 seconds') then
    return jsonb_build_object('code','FORBIDDEN');
  end if;

  update scans set voided_at = now(), voided_by = p_staff_user_id, void_reason = p_reason where id = s.id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (s.event_id, p_staff_user_id, 'staff', 'scan.void', s.id,
          jsonb_build_object('checkpoint_id', s.checkpoint_id));
  return jsonb_build_object('code','VOIDED');
end $$;
revoke all on function public.void_scan(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.void_scan(uuid, uuid, text) to service_role;

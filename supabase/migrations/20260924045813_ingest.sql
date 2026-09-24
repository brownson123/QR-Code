-- SPEC F3 transition table for one Sheet row, keyed by (event_id, external_id) (I-14).
-- Inputs arrive validated and normalized by the app (I-12). One call = one transaction, so rows are
-- independent. With p_dry_run the same decisions are made but nothing is written (F10 "Sync now").
--
-- Beyond the SPEC table (agreed in the S3 plan):
--   * a tombstoned participant is left alone                                   → UNCHANGED
--   * not accepted → another non-accepted status, or changed name/dietary/etc.  → UPDATED
--   * a changed email that already belongs to someone else in the event        → CONFLICT_DUPLICATE_EMAIL
create or replace function public.ingest_sheet_row(
  p_event_id      uuid,
  p_external_id   text,
  p_email         text,
  p_first_name    text,
  p_last_name     text,
  p_search_text   text,
  p_status        participant_status,
  p_dietary_notes text    default null,
  p_linkedin_url  text    default null,
  p_dry_run       boolean default false
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pa participants%rowtype;
  details_changed boolean;
  email_taken boolean;
begin
  select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;

  if not found then
    if exists (select 1 from participants where event_id = p_event_id and email = p_email) then
      return 'CONFLICT_DUPLICATE_EMAIL';
    end if;
    if p_dry_run then
      return case when p_status = 'accepted' then 'PASS_QUEUED' else 'CREATED' end;
    end if;
    begin
      insert into participants (event_id, external_id, email, first_name, last_name, search_text,
                                dietary_notes, linkedin_url, status, source)
      values (p_event_id, p_external_id, p_email, p_first_name, p_last_name, p_search_text,
              p_dietary_notes, p_linkedin_url, p_status, 'sheet')
      on conflict (event_id, external_id) do nothing
      returning * into pa;
    exception when unique_violation then
      -- (event_id, email) taken by a concurrent insert under another external_id.
      return 'CONFLICT_DUPLICATE_EMAIL';
    end;
    if found then
      if p_status = 'accepted' then
        insert into email_outbox (participant_id, kind) values (pa.id, 'pass_issued')
        on conflict (participant_id) where status in ('pending','sending') do nothing;
        return 'PASS_QUEUED';
      end if;
      return 'CREATED';
    end if;
    -- A concurrent request inserted this external_id first: continue as an existing row.
    select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;
  end if;

  if pa.deleted_at is not null then
    return 'UNCHANGED';
  end if;

  details_changed := pa.first_name    is distinct from p_first_name
                  or pa.last_name     is distinct from p_last_name
                  or pa.dietary_notes is distinct from p_dietary_notes
                  or pa.linkedin_url  is distinct from p_linkedin_url;
  email_taken := pa.email <> p_email and exists (
    select 1 from participants where event_id = p_event_id and email = p_email and id <> pa.id);

  if pa.status = 'accepted' then
    if p_status = 'pending' then
      return 'IGNORED_CLEAR';  -- DECISION: an accidentally cleared cell must not kill a pass
    end if;

    if p_status = 'accepted' then
      if pa.email <> p_email then
        if email_taken then return 'CONFLICT_DUPLICATE_EMAIL'; end if;
        if not p_dry_run then
          update participants
             set email = p_email, first_name = p_first_name, last_name = p_last_name, search_text = p_search_text,
                 dietary_notes = p_dietary_notes, linkedin_url = p_linkedin_url, updated_at = now()
           where id = pa.id;
          -- Rotation on send revokes the old pass. A pending row already queued will go to the new address.
          insert into email_outbox (participant_id, kind) values (pa.id, 'pass_reissued')
          on conflict (participant_id) where status in ('pending','sending') do nothing;
          insert into audit_log (event_id, actor_kind, action, subject_id)
          values (p_event_id, 'sheet_sync', 'participant.email_change', pa.id);
        end if;
        return 'PASS_QUEUED';
      end if;
      if not details_changed then return 'UNCHANGED'; end if;
      if not p_dry_run then
        update participants
           set first_name = p_first_name, last_name = p_last_name, search_text = p_search_text,
               dietary_notes = p_dietary_notes, linkedin_url = p_linkedin_url, updated_at = now()
         where id = pa.id;
      end if;
      return 'UPDATED';
    end if;

    -- accepted → waitlisted / rejected / withdrawn
    if email_taken then return 'CONFLICT_DUPLICATE_EMAIL'; end if;
    if not p_dry_run then
      update participants
         set status = p_status, email = p_email, first_name = p_first_name, last_name = p_last_name,
             search_text = p_search_text, dietary_notes = p_dietary_notes, linkedin_url = p_linkedin_url,
             updated_at = now()
       where id = pa.id;
      update passes set revoked_at = now(), revoke_reason = 'status_change'
       where participant_id = pa.id and revoked_at is null;
      update email_outbox set status = 'cancelled', locked_until = null
       where participant_id = pa.id and status in ('pending','sending');
    end if;
    return 'REVOKED';
  end if;

  -- Existing participant who is not accepted.
  if email_taken then return 'CONFLICT_DUPLICATE_EMAIL'; end if;
  if p_status <> 'accepted' and pa.status = p_status and pa.email = p_email and not details_changed then
    return 'UNCHANGED';
  end if;
  if not p_dry_run then
    update participants
       set status = p_status, email = p_email, first_name = p_first_name, last_name = p_last_name,
           search_text = p_search_text, dietary_notes = p_dietary_notes, linkedin_url = p_linkedin_url,
           updated_at = now()
     where id = pa.id;
    if p_status = 'accepted' then
      insert into email_outbox (participant_id, kind) values (pa.id, 'pass_issued')
      on conflict (participant_id) where status in ('pending','sending') do nothing;
    end if;
  end if;
  return case when p_status = 'accepted' then 'PASS_QUEUED' else 'UPDATED' end;
end $$;
revoke all on function public.ingest_sheet_row(uuid, text, text, text, text, text, participant_status, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.ingest_sheet_row(uuid, text, text, text, text, text, participant_status, text, text, boolean)
  to service_role;

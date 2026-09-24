-- SPEC F9 invite consumption and §10.4 manual search.

-- Called by the auth callback with the user's VERIFIED email. An invite states the organizer's
-- intent, so it also updates the role of someone who is already staff on that event.
create or replace function public.consume_staff_invites(p_user_id uuid, p_email text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  with consumed as (
    delete from staff_invites where email = lower(btrim(p_email)) returning event_id, role
  )
  insert into event_staff (event_id, user_id, role)
  select event_id, p_user_id, role from consumed
  on conflict (event_id, user_id) do update set role = excluded.role;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.consume_staff_invites(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_staff_invites(uuid, text) to service_role;

-- §10.4. p_query arrives normalized by toSearchText() (I-12), so it holds only letters, digits and
-- single spaces: no LIKE wildcards to escape. pg_trgm lives in `extensions`; its operator and
-- function are schema-qualified so search_path stays exactly `public, pg_temp` (I-6).
-- Beyond the SPEC's two predicates, a space-insensitive LIKE lets "obrien" find "O'Brien" (T-SRCH-02).
create or replace function public.search_participants(p_event_id uuid, p_query text, p_checkpoint_id uuid default null)
returns table (
  id uuid, first_name text, last_name text, email text, status participant_status, photo_path text, scanned_here boolean
) language sql stable security definer set search_path = public, pg_temp as $$
  select pa.id, pa.first_name, pa.last_name, pa.email, pa.status, pa.photo_path,
         p_checkpoint_id is not null and exists (
           select 1 from scans s
            where s.participant_id = pa.id and s.checkpoint_id = p_checkpoint_id and s.voided_at is null) as scanned_here
    from participants pa
   where pa.event_id = p_event_id
     and pa.deleted_at is null
     and (pa.search_text operator(extensions.%) p_query
          or pa.search_text like '%' || p_query || '%'
          or replace(pa.search_text, ' ', '') like '%' || replace(p_query, ' ', '') || '%')
   order by extensions.similarity(pa.search_text, p_query) desc, pa.first_name, pa.id
   limit 10
$$;
revoke all on function public.search_participants(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.search_participants(uuid, text, uuid) to service_role;

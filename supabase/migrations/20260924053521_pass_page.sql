-- SPEC F5 pass page + photo, §15 rate limits.

-- Private photo bucket. storage.objects keeps Supabase's RLS with no policies for anon/authenticated,
-- so only the service role (after our own checks) reads or writes. Staff get 300 s signed URLs.
-- Only our processed output is ever stored: 512×512 JPEG, well under 2 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2 * 1024 * 1024, array['image/jpeg'])
on conflict (id) do nothing;

-- Fixed-window counter in Postgres (serverless has no shared memory). Returns true while within limit.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds int, p_limit int)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n int;
begin
  insert into rate_limits (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into n;
  return n <= p_limit;
end $$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- Everything the pass page and photo upload need about a token, in one round trip. Null if unknown.
create or replace function public.pass_lookup(p_token_hash text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'pass', jsonb_build_object('id', ps.id, 'revokedAt', ps.revoked_at, 'revokeReason', ps.revoke_reason),
    'participant', jsonb_build_object(
      'id', pa.id, 'eventId', pa.event_id, 'firstName', pa.first_name, 'status', pa.status,
      'deleted', pa.deleted_at is not null, 'photoPath', pa.photo_path, 'photoUpdatedAt', pa.photo_updated_at),
    'event', jsonb_build_object('name', e.name, 'venue', e.venue, 'startsAt', e.starts_at, 'timezone', e.timezone),
    'checkedIn', exists (
      select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
       where s.participant_id = pa.id and c.kind = 'door' and s.voided_at is null))
    from passes ps
    join participants pa on pa.id = ps.participant_id
    join events e on e.id = pa.event_id
   where ps.token_hash = p_token_hash
$$;
revoke all on function public.pass_lookup(text) from public, anon, authenticated;
grant execute on function public.pass_lookup(text) to service_role;

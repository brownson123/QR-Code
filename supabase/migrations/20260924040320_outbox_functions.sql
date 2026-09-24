-- SPEC F4 outbox claim/finish. SKIP LOCKED can't be expressed through PostgREST, hence functions.

-- The F4 claim, verbatim: pending rows that are due, plus rows whose drainer's lease expired.
create or replace function public.claim_outbox(p_limit int default 20)
returns setof email_outbox language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update email_outbox o
     set status = 'sending', locked_until = now() + interval '2 minutes', attempts = attempts + 1
   where o.id in (
     select id from email_outbox
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'sending' and locked_until < now())
      order by next_attempt_at
      limit p_limit
      for update skip locked)
  returning o.*;
end $$;
revoke all on function public.claim_outbox(int) from public, anon, authenticated;
grant execute on function public.claim_outbox(int) to service_role;

-- Records the outcome of one claimed row. Only a row still in 'sending' is updated, so a drainer
-- whose lease expired cannot overwrite the result of the drainer that reclaimed the row.
create or replace function public.finish_outbox(
  p_id                  uuid,
  p_status              outbox_status,
  p_next_attempt_at     timestamptz default null,
  p_last_error          text        default null,
  p_provider_message_id text        default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status = 'sending' then
    raise exception 'finish_outbox: status must be terminal or pending';
  end if;
  update email_outbox
     set status              = p_status,
         locked_until        = null,
         next_attempt_at     = coalesce(p_next_attempt_at, next_attempt_at),
         last_error          = coalesce(p_last_error, last_error),
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         sent_at             = case when p_status = 'sent' then now() else sent_at end
   where id = p_id and status = 'sending';
  return found;
end $$;
revoke all on function public.finish_outbox(uuid, outbox_status, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.finish_outbox(uuid, outbox_status, timestamptz, text, text) to service_role;

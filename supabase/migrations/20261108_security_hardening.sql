-- Security hardening for Mihnati.
-- Apply after 20261108_secure_backend.sql.

-- A signed-in user may create only a worker or business profile, never an admin profile.
drop policy if exists "profile insert own" on public.profiles;
drop policy if exists "users can insert own non-admin profile" on public.profiles;
create policy "users can insert own non-admin profile"
on public.profiles for insert to authenticated
with check (
  id = auth.uid()
  and account_type in ('worker'::public.account_type, 'business'::public.account_type)
);

-- Keep account roles immutable from the client. The previous migration already
-- grants updates only to ordinary profile columns, but explicitly revoke any
-- table-level update privilege that could bypass column grants.
revoke update on public.profiles from anon, authenticated;
grant update(full_name, phone, location_text, business_name)
on public.profiles to authenticated;

-- A business may publish only jobs under its own registered business type.
drop policy if exists "business owners can insert jobs" on public.jobs;
create policy "business owners can insert jobs"
on public.jobs for insert to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.account_type = 'business'::public.account_type
      and p.business_type = jobs.business_type
  )
);

-- Do not allow clients to directly change booking/job state. State transitions
-- are performed only by the transactional SECURITY DEFINER RPC functions.
revoke insert, update, delete on public.bookings from anon, authenticated;
revoke update, delete on public.jobs from anon, authenticated;
grant select on public.bookings to authenticated;
grant select, insert on public.messages to authenticated;

-- Validate message body and make sure the sender is an active participant.
drop policy if exists "booking participants can send messages" on public.messages;
create policy "booking participants can send messages"
on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and char_length(trim(body)) between 1 and 5000
  and exists (
    select 1 from public.bookings b
    where b.id = booking_id
      and b.status in ('pending'::public.booking_status, 'agreed'::public.booking_status)
      and (b.worker_id = auth.uid() or b.owner_id = auth.uid())
  )
);

-- A cancelled booking remains in history, while the job becomes open again.
-- The partial unique index from schema.sql continues to allow a new booking.

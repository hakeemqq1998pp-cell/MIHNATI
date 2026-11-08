-- Worker arrival confirmation and private Telegram notification outbox.
alter table public.mihnati_bookings add column if not exists arrived_at timestamptz;
create or replace function private.mihnati_mark_arrived_impl(p_booking_id uuid)
returns public.mihnati_bookings language plpgsql security definer set search_path=''
as $$
declare b public.mihnati_bookings;
begin
 if (select auth.uid()) is null then raise exception 'يجب تسجيل الدخول'; end if;
 select * into b from public.mihnati_bookings where id=p_booking_id for update;
 if not found or b.status<>'agreed' then raise exception 'يجب أن يكون الاتفاق مكتملاً أولاً'; end if;
 if b.worker_id<>(select auth.uid()) then raise exception 'تسجيل الوصول متاح للعامل فقط'; end if;
 update public.mihnati_bookings set arrived_at=coalesce(arrived_at,now()) where id=b.id returning * into b;
 return b;
end; $$;
revoke all on function private.mihnati_mark_arrived_impl(uuid) from public,anon;
grant execute on function private.mihnati_mark_arrived_impl(uuid) to authenticated;
create or replace function public.mihnati_mark_arrived(p_booking_id uuid)
returns public.mihnati_bookings language sql security invoker set search_path=''
as $$ select private.mihnati_mark_arrived_impl(p_booking_id); $$;
revoke all on function public.mihnati_mark_arrived(uuid) from public,anon;
grant execute on function public.mihnati_mark_arrived(uuid) to authenticated;

create table if not exists public.mihnati_notification_events(
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.mihnati_bookings(id) on delete cascade,
 event_type text not null check(event_type in ('reserved','arrived')),
 status text not null default 'pending' check(status in ('pending','sent','failed')),
 attempts integer not null default 0,
 last_error text,
 sent_at timestamptz,
 created_at timestamptz not null default now(),
 unique(booking_id,event_type)
);
alter table public.mihnati_notification_events enable row level security;
revoke all on public.mihnati_notification_events from anon,authenticated;
grant all on public.mihnati_notification_events to service_role;

-- Explicitly deny client-role access; the server-side service role bypasses RLS.
drop policy if exists mihnati_notification_events_deny_clients on public.mihnati_notification_events;
create policy mihnati_notification_events_deny_clients on public.mihnati_notification_events as restrictive for all to anon,authenticated using(false) with check(false);

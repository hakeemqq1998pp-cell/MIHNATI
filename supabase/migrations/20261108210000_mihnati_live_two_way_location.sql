-- Consent-gated, current-position-only two-way tracking for agreed bookings.
alter table public.mihnati_bookings
  add column if not exists worker_location_sharing boolean not null default false,
  add column if not exists owner_location_sharing boolean not null default false;

create table if not exists public.mihnati_live_locations (
  booking_id uuid not null references public.mihnati_bookings(id) on delete cascade,
  user_id uuid not null references public.mihnati_profiles(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or accuracy_m between 0 and 10000),
  updated_at timestamptz not null default now(),
  primary key (booking_id,user_id)
);
create index if not exists mihnati_live_locations_updated_idx on public.mihnati_live_locations(updated_at desc);
alter table public.mihnati_live_locations enable row level security;
revoke all on public.mihnati_live_locations from anon,authenticated;
grant select on public.mihnati_live_locations to authenticated;
drop policy if exists mihnati_live_locations_read_parties on public.mihnati_live_locations;
create policy mihnati_live_locations_read_parties on public.mihnati_live_locations
for select to authenticated using (
 exists (
  select 1 from public.mihnati_bookings b
  where b.id=booking_id and b.status='agreed'
    and b.worker_location_sharing and b.owner_location_sharing
    and (b.worker_id=(select auth.uid()) or b.owner_id=(select auth.uid()))
 )
);

create or replace function private.mihnati_set_location_sharing_impl(p_booking_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path=''
as $$
declare b public.mihnati_bookings;
begin
 if (select auth.uid()) is null then raise exception 'يجب تسجيل الدخول'; end if;
 select * into b from public.mihnati_bookings where id=p_booking_id for update;
 if not found or b.status<>'agreed' then raise exception 'تتبع الموقع متاح بعد الاتفاق فقط'; end if;
 if b.worker_id=(select auth.uid()) then
  update public.mihnati_bookings set worker_location_sharing=p_enabled where id=b.id;
 elsif b.owner_id=(select auth.uid()) then
  update public.mihnati_bookings set owner_location_sharing=p_enabled where id=b.id;
 else raise exception 'غير مخول'; end if;
 if not p_enabled then
  delete from public.mihnati_live_locations where booking_id=p_booking_id and user_id=(select auth.uid());
 end if;
end; $$;

create or replace function private.mihnati_update_live_location_impl(
 p_booking_id uuid,p_latitude double precision,p_longitude double precision,p_accuracy_m double precision default null
) returns timestamptz language plpgsql security definer set search_path=''
as $$
declare b public.mihnati_bookings; v_time timestamptz:=now();
begin
 if (select auth.uid()) is null then raise exception 'يجب تسجيل الدخول'; end if;
 if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
  raise exception 'إحداثيات الموقع غير صحيحة';
 end if;
 if p_accuracy_m is not null and (p_accuracy_m<0 or p_accuracy_m>10000) then raise exception 'دقة الموقع غير صحيحة'; end if;
 select * into b from public.mihnati_bookings where id=p_booking_id;
 if not found or b.status<>'agreed' then raise exception 'الحجز غير نشط'; end if;
 if b.worker_id<>(select auth.uid()) and b.owner_id<>(select auth.uid()) then raise exception 'غير مخول'; end if;
 if not b.worker_location_sharing or not b.owner_location_sharing then raise exception 'يجب أن يوافق الطرفان على مشاركة الموقع'; end if;
 insert into public.mihnati_live_locations(booking_id,user_id,latitude,longitude,accuracy_m,updated_at)
 values(p_booking_id,(select auth.uid()),p_latitude,p_longitude,p_accuracy_m,v_time)
 on conflict(booking_id,user_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,
 accuracy_m=excluded.accuracy_m,updated_at=excluded.updated_at;
 return v_time;
end; $$;

revoke all on function private.mihnati_set_location_sharing_impl(uuid,boolean) from public,anon;
revoke all on function private.mihnati_update_live_location_impl(uuid,double precision,double precision,double precision) from public,anon;
grant execute on function private.mihnati_set_location_sharing_impl(uuid,boolean) to authenticated;
grant execute on function private.mihnati_update_live_location_impl(uuid,double precision,double precision,double precision) to authenticated;

create or replace function public.mihnati_set_location_sharing(p_booking_id uuid,p_enabled boolean)
returns void language sql security invoker set search_path=''
as $$ select private.mihnati_set_location_sharing_impl(p_booking_id,p_enabled); $$;
create or replace function public.mihnati_update_live_location(
 p_booking_id uuid,p_latitude double precision,p_longitude double precision,p_accuracy_m double precision default null
) returns timestamptz language sql security invoker set search_path=''
as $$ select private.mihnati_update_live_location_impl(p_booking_id,p_latitude,p_longitude,p_accuracy_m); $$;
revoke all on function public.mihnati_set_location_sharing(uuid,boolean) from public,anon;
revoke all on function public.mihnati_update_live_location(uuid,double precision,double precision,double precision) from public,anon;
grant execute on function public.mihnati_set_location_sharing(uuid,boolean) to authenticated;
grant execute on function public.mihnati_update_live_location(uuid,double precision,double precision,double precision) to authenticated;

do $$
begin
 if not exists (
  select 1 from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' and tablename='mihnati_live_locations'
 ) then
  alter publication supabase_realtime add table public.mihnati_live_locations;
 end if;
end $$;

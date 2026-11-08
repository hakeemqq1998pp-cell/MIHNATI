-- MIHNATI application schema for the connected Supabase project.
-- Safe coexistence: the original 26 public tables are retained and isolated.
create extension if not exists pgcrypto;
do $$ begin create type public.mihnati_account_type as enum ('worker','business'); exception when duplicate_object then null; end $$;
do $$ begin create type public.mihnati_business_type as enum ('oven','bakery','restaurant'); exception when duplicate_object then null; end $$;
do $$ begin create type public.mihnati_job_status as enum ('open','reserved','agreed','closed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.mihnati_booking_status as enum ('pending','agreed','cancelled'); exception when duplicate_object then null; end $$;

create table if not exists public.mihnati_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 account_type public.mihnati_account_type not null,
 full_name text not null check(char_length(trim(full_name)) between 1 and 120),
 phone text not null check(char_length(trim(phone)) between 3 and 40),
 location_text text not null check(char_length(trim(location_text)) between 1 and 250),
 business_type public.mihnati_business_type,
 business_name text,
 created_at timestamptz not null default now(),
 constraint mihnati_business_profile_check check (
  (account_type='business' and business_type is not null and business_name is not null and char_length(trim(business_name))>0)
  or (account_type='worker' and business_type is null)
 )
);
create table if not exists public.mihnati_jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.mihnati_profiles(id),
 business_type public.mihnati_business_type not null,
 business_name text not null check(char_length(trim(business_name)) between 1 and 160),
 job_title text not null check(char_length(trim(job_title)) between 1 and 160),
 details text,
 wage integer not null check(wage>=0),
 time text not null,
 shift text not null,
 location_text text not null,
 latitude double precision,
 longitude double precision,
 status public.mihnati_job_status not null default 'open',
 created_at timestamptz not null default now()
);
create table if not exists public.mihnati_bookings (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.mihnati_jobs(id),
 worker_id uuid not null references public.mihnati_profiles(id),
 owner_id uuid not null references public.mihnati_profiles(id),
 status public.mihnati_booking_status not null default 'pending',
 worker_agreed boolean not null default false,
 owner_agreed boolean not null default false,
 cancelled_by uuid references public.mihnati_profiles(id),
 created_at timestamptz not null default now(),
 constraint mihnati_booking_distinct_parties check(worker_id<>owner_id)
);
create unique index if not exists mihnati_one_active_booking_per_job on public.mihnati_bookings(job_id) where status in ('pending','agreed');
create index if not exists mihnati_jobs_status_created_idx on public.mihnati_jobs(status,created_at desc);
create index if not exists mihnati_jobs_owner_id_idx on public.mihnati_jobs(owner_id);
create index if not exists mihnati_bookings_worker_idx on public.mihnati_bookings(worker_id,created_at desc);
create index if not exists mihnati_bookings_owner_idx on public.mihnati_bookings(owner_id,created_at desc);
create index if not exists mihnati_bookings_cancelled_by_idx on public.mihnati_bookings(cancelled_by);
create table if not exists public.mihnati_messages (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.mihnati_bookings(id) on delete cascade,
 sender_id uuid not null references public.mihnati_profiles(id),
 body text not null check(char_length(trim(body)) between 1 and 5000),
 created_at timestamptz not null default now()
);
create index if not exists mihnati_messages_booking_created_idx on public.mihnati_messages(booking_id,created_at);
create index if not exists mihnati_messages_sender_id_idx on public.mihnati_messages(sender_id);

alter table public.mihnati_profiles enable row level security;
alter table public.mihnati_jobs enable row level security;
alter table public.mihnati_bookings enable row level security;
alter table public.mihnati_messages enable row level security;
revoke all on public.mihnati_profiles,public.mihnati_jobs,public.mihnati_bookings,public.mihnati_messages from anon,authenticated;
grant select on public.mihnati_profiles to authenticated;
grant insert(id,account_type,full_name,phone,location_text,business_type,business_name) on public.mihnati_profiles to authenticated;
grant update(full_name,phone,location_text,business_name) on public.mihnati_profiles to authenticated;
grant select on public.mihnati_jobs to authenticated;
grant insert(owner_id,business_type,business_name,job_title,details,wage,time,shift,location_text,latitude,longitude) on public.mihnati_jobs to authenticated;
grant select on public.mihnati_bookings to authenticated;
grant select,insert on public.mihnati_messages to authenticated;

drop policy if exists mihnati_profile_select_self on public.mihnati_profiles;
create policy mihnati_profile_select_self on public.mihnati_profiles for select to authenticated using(id=(select auth.uid()));
drop policy if exists mihnati_profile_insert_self on public.mihnati_profiles;
create policy mihnati_profile_insert_self on public.mihnati_profiles for insert to authenticated with check(id=(select auth.uid()) and account_type in ('worker','business'));
drop policy if exists mihnati_profile_update_self on public.mihnati_profiles;
create policy mihnati_profile_update_self on public.mihnati_profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
drop policy if exists mihnati_jobs_read on public.mihnati_jobs;
create policy mihnati_jobs_read on public.mihnati_jobs for select to authenticated using(true);
drop policy if exists mihnati_jobs_insert_business on public.mihnati_jobs;
create policy mihnati_jobs_insert_business on public.mihnati_jobs for insert to authenticated with check(owner_id=(select auth.uid()) and exists(select 1 from public.mihnati_profiles p where p.id=(select auth.uid()) and p.account_type='business' and p.business_type=mihnati_jobs.business_type));
drop policy if exists mihnati_bookings_read_parties on public.mihnati_bookings;
create policy mihnati_bookings_read_parties on public.mihnati_bookings for select to authenticated using(worker_id=(select auth.uid()) or owner_id=(select auth.uid()));
drop policy if exists mihnati_messages_read_parties on public.mihnati_messages;
create policy mihnati_messages_read_parties on public.mihnati_messages for select to authenticated using(exists(select 1 from public.mihnati_bookings b where b.id=booking_id and (b.worker_id=(select auth.uid()) or b.owner_id=(select auth.uid()))));
drop policy if exists mihnati_messages_insert_parties on public.mihnati_messages;
create policy mihnati_messages_insert_parties on public.mihnati_messages for insert to authenticated with check(sender_id=(select auth.uid()) and char_length(trim(body)) between 1 and 5000 and exists(select 1 from public.mihnati_bookings b where b.id=booking_id and b.status in ('pending','agreed') and (b.worker_id=(select auth.uid()) or b.owner_id=(select auth.uid()))));

create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;

create or replace function private.mihnati_reserve_job_impl(p_job_id uuid)
returns public.mihnati_bookings language plpgsql security definer set search_path=''
as $$
declare j public.mihnati_jobs; b public.mihnati_bookings;
begin
 if (select auth.uid()) is null then raise exception 'يجب تسجيل الدخول'; end if;
 if not exists(select 1 from public.mihnati_profiles p where p.id=(select auth.uid()) and p.account_type='worker') then raise exception 'الحجز متاح لحساب العامل فقط'; end if;
 select * into j from public.mihnati_jobs where id=p_job_id for update;
 if not found or j.status<>'open' then raise exception 'الوظيفة غير متاحة للحجز'; end if;
 if j.owner_id=(select auth.uid()) then raise exception 'لا يمكنك حجز وظيفتك'; end if;
 insert into public.mihnati_bookings(job_id,worker_id,owner_id) values(j.id,(select auth.uid()),j.owner_id) returning * into b;
 update public.mihnati_jobs set status='reserved' where id=j.id;
 return b;
end; $$;
create or replace function private.mihnati_agree_booking_impl(p_booking_id uuid)
returns public.mihnati_bookings language plpgsql security definer set search_path=''
as $$
declare b public.mihnati_bookings;
begin
 if (select auth.uid()) is null then raise exception 'يجب تسجيل الدخول'; end if;
 select * into b from public.mihnati_bookings where id=p_booking_id for update;
 if not found or b.status<>'pending' then raise exception 'الحجز غير معلق'; end if;
 if (select auth.uid())=b.worker_id then update public.mihnati_bookings set worker_agreed=true where id=b.id returning * into b;
 elsif (select auth.uid())=b.owner_id then update public.mihnati_bookings set owner_agreed=true where id=b.id returning * into b;
 else raise exception 'غير مخول'; end if;
 if b.worker_agreed and b.owner_agreed then
  update public.mihnati_bookings set status='agreed' where id=b.id returning * into b;
  update public.mihnati_jobs set status='agreed' where id=b.job_id;
 end if;
 return b;
end; $$;
create or replace function private.mihnati_cancel_booking_impl(p_booking_id uuid)
returns public.mihnati_bookings language plpgsql security definer set search_path=''
as $$
declare b public.mihnati_bookings;
begin
 if (select auth.uid()) is null then raise exception 'يجب تسجيل الدخول'; end if;
 select * into b from public.mihnati_bookings where id=p_booking_id for update;
 if not found or b.status<>'pending' then raise exception 'لا يمكن إلغاء هذا الحجز'; end if;
 if (select auth.uid()) not in (b.worker_id,b.owner_id) then raise exception 'غير مخول'; end if;
 update public.mihnati_bookings set status='cancelled',cancelled_by=(select auth.uid()) where id=b.id returning * into b;
 update public.mihnati_jobs set status='open' where id=b.job_id and status='reserved';
 return b;
end; $$;
revoke all on function private.mihnati_reserve_job_impl(uuid) from public,anon;
revoke all on function private.mihnati_agree_booking_impl(uuid) from public,anon;
revoke all on function private.mihnati_cancel_booking_impl(uuid) from public,anon;
grant execute on function private.mihnati_reserve_job_impl(uuid) to authenticated;
grant execute on function private.mihnati_agree_booking_impl(uuid) to authenticated;
grant execute on function private.mihnati_cancel_booking_impl(uuid) to authenticated;

create or replace function public.mihnati_reserve_job(p_job_id uuid)
returns public.mihnati_bookings language sql security invoker set search_path=''
as $$ select private.mihnati_reserve_job_impl(p_job_id); $$;
create or replace function public.mihnati_agree_booking(p_booking_id uuid)
returns public.mihnati_bookings language sql security invoker set search_path=''
as $$ select private.mihnati_agree_booking_impl(p_booking_id); $$;
create or replace function public.mihnati_cancel_booking(p_booking_id uuid)
returns public.mihnati_bookings language sql security invoker set search_path=''
as $$ select private.mihnati_cancel_booking_impl(p_booking_id); $$;
revoke all on function public.mihnati_reserve_job(uuid) from public,anon;
revoke all on function public.mihnati_agree_booking(uuid) from public,anon;
revoke all on function public.mihnati_cancel_booking(uuid) from public,anon;
grant execute on function public.mihnati_reserve_job(uuid) to authenticated;
grant execute on function public.mihnati_agree_booking(uuid) to authenticated;
grant execute on function public.mihnati_cancel_booking(uuid) to authenticated;

-- Isolate the unused legacy schema. Existing records are preserved, but no
-- client API role can access these tables until their own policies are reviewed.
do $$
declare r record;
begin
 for r in select schemaname,tablename from pg_tables where schemaname='public'
 and tablename not in ('mihnati_profiles','mihnati_jobs','mihnati_bookings','mihnati_messages')
 loop
  execute format('drop policy if exists %I on %I.%I','legacy_deny_all',r.schemaname,r.tablename);
  execute format('create policy %I on %I.%I as restrictive for all to anon,authenticated using(false) with check(false)','legacy_deny_all',r.schemaname,r.tablename);
  execute format('revoke all on table %I.%I from anon,authenticated',r.schemaname,r.tablename);
 end loop;
end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

do $$ begin alter publication supabase_realtime add table public.mihnati_jobs; exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.mihnati_bookings; exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.mihnati_messages; exception when duplicate_object then null; when undefined_object then null; end $$;

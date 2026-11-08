create extension if not exists pgcrypto;
create type public.account_type as enum('worker','business','admin');
create type public.business_type as enum('oven','bakery','restaurant');
create type public.job_status as enum('open','reserved','agreed','cancelled','closed');
create type public.booking_status as enum('pending','agreed','cancelled');
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,account_type public.account_type not null,full_name text not null,phone text not null,location_text text not null,national_id text,business_type public.business_type,business_name text,created_at timestamptz default now());
create table public.jobs(id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id),business_type public.business_type not null,business_name text not null,job_title text not null,details text,wage integer not null check(wage>=0),time text not null,shift text not null,location_text text not null,latitude double precision,longitude double precision,status public.job_status not null default 'open',created_at timestamptz default now());
create table public.bookings(id uuid primary key default gen_random_uuid(),job_id uuid not null references public.jobs(id),worker_id uuid not null references public.profiles(id),owner_id uuid not null references public.profiles(id),status public.booking_status not null default 'pending',worker_agreed boolean not null default false,owner_agreed boolean not null default false,cancelled_by uuid references public.profiles(id),created_at timestamptz default now());
create unique index one_active_booking_per_job on public.bookings(job_id) where status in('pending','agreed');
create table public.messages(id uuid primary key default gen_random_uuid(),booking_id uuid not null references public.bookings(id) on delete cascade,sender_id uuid not null references public.profiles(id),body text not null check(char_length(body) between 1 and 5000),created_at timestamptz default now());
alter table public.profiles enable row level security;alter table public.jobs enable row level security;alter table public.bookings enable row level security;alter table public.messages enable row level security;
create policy "profile read" on public.profiles for select to authenticated using(true);
create policy "profile insert own" on public.profiles for insert to authenticated with check(id=auth.uid());
create policy "profile update own" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy "jobs read" on public.jobs for select to authenticated using(true);
create policy "business insert jobs" on public.jobs for insert to authenticated with check(owner_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.account_type='business'));
create policy "owner update jobs" on public.jobs for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "booking parties read" on public.bookings for select to authenticated using(worker_id=auth.uid() or owner_id=auth.uid());
create policy "worker creates booking" on public.bookings for insert to authenticated with check(worker_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.account_type='worker'));
create policy "booking parties update" on public.bookings for update to authenticated using(worker_id=auth.uid() or owner_id=auth.uid()) with check(worker_id=auth.uid() or owner_id=auth.uid());
create policy "messages parties read" on public.messages for select to authenticated using(exists(select 1 from public.bookings b where b.id=booking_id and (b.worker_id=auth.uid() or b.owner_id=auth.uid())));
create policy "messages parties send" on public.messages for insert to authenticated with check(sender_id=auth.uid() and exists(select 1 from public.bookings b where b.id=booking_id and b.status='pending' and (b.worker_id=auth.uid() or b.owner_id=auth.uid())));
-- Before production: implement transactional RPCs for booking, agreement and cancellation with row locks.
-- National IDs are sensitive: do not store plaintext or expose them through public queries.
-- Manual 3,000 IQD transfer is outside the application; no wallet or payment gateway exists.

-- Apply after supabase/schema.sql in the Supabase SQL Editor.
-- Do not collect national ID in the app until a dedicated encrypted verification flow exists.
-- Remove broad profile reads and explicitly grant only non-sensitive columns.
drop policy if exists "profile read" on public.profiles;
revoke select on public.profiles from anon, authenticated;
grant select(id,account_type,full_name,phone,location_text,business_type,business_name,created_at) on public.profiles to authenticated;
grant insert(id,account_type,full_name,phone,location_text,business_type,business_name) on public.profiles to authenticated;
grant update(full_name,phone,location_text,business_name) on public.profiles to authenticated;

drop policy if exists "booking parties update" on public.bookings;
drop policy if exists "worker creates booking" on public.bookings;
drop policy if exists "booking parties read" on public.bookings;
drop policy if exists "business insert jobs" on public.jobs;
drop policy if exists "owner update jobs" on public.jobs;
drop policy if exists "jobs read" on public.jobs;
drop policy if exists "messages parties read" on public.messages;
drop policy if exists "messages parties send" on public.messages;

create policy "authenticated can read jobs" on public.jobs for select to authenticated using(true);
create policy "business owners can insert jobs" on public.jobs for insert to authenticated
with check(owner_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.account_type='business'));
create policy "booking participants can read" on public.bookings for select to authenticated
using(worker_id=auth.uid() or owner_id=auth.uid());
create policy "booking participants can read messages" on public.messages for select to authenticated
using(exists(select 1 from public.bookings b where b.id=booking_id and (b.worker_id=auth.uid() or b.owner_id=auth.uid())));
create policy "booking participants can send messages" on public.messages for insert to authenticated
with check(sender_id=auth.uid() and exists(select 1 from public.bookings b where b.id=booking_id and b.status in('pending','agreed') and (b.worker_id=auth.uid() or b.owner_id=auth.uid())));

create or replace function public.reserve_job(p_job_id uuid)
returns public.bookings language plpgsql security definer set search_path=public as $$
declare j public.jobs; b public.bookings;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and account_type='worker') then raise exception 'الحجز متاح لحساب العامل فقط'; end if;
  select * into j from public.jobs where id=p_job_id for update;
  if not found or j.status<>'open' then raise exception 'الوظيفة غير متاحة للحجز'; end if;
  if j.owner_id=auth.uid() then raise exception 'لا يمكنك حجز وظيفتك'; end if;
  insert into public.bookings(job_id,worker_id,owner_id) values(j.id,auth.uid(),j.owner_id) returning * into b;
  update public.jobs set status='reserved' where id=j.id;
  return b;
end; $$;

create or replace function public.agree_booking(p_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path=public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.status<>'pending' then raise exception 'الحجز غير معلق'; end if;
  if auth.uid()=b.worker_id then update public.bookings set worker_agreed=true where id=b.id returning * into b;
  elsif auth.uid()=b.owner_id then update public.bookings set owner_agreed=true where id=b.id returning * into b;
  else raise exception 'غير مخول'; end if;
  if b.worker_agreed and b.owner_agreed then
    update public.bookings set status='agreed' where id=b.id returning * into b;
    update public.jobs set status='agreed' where id=b.job_id;
  end if;
  return b;
end; $$;

create or replace function public.cancel_booking(p_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path=public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or b.status<>'pending' then raise exception 'لا يمكن إلغاء هذا الحجز'; end if;
  if auth.uid() not in (b.worker_id,b.owner_id) then raise exception 'غير مخول'; end if;
  update public.bookings set status='cancelled',cancelled_by=auth.uid() where id=b.id returning * into b;
  update public.jobs set status='open' where id=b.job_id and status='reserved';
  return b;
end; $$;

revoke all on function public.reserve_job(uuid) from public;
revoke all on function public.agree_booking(uuid) from public;
revoke all on function public.cancel_booking(uuid) from public;
grant execute on function public.reserve_job(uuid) to authenticated;
grant execute on function public.agree_booking(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;

-- Enable realtime for live chat and booking updates (ignore duplicate publication membership errors).
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.bookings;
exception when duplicate_object then null; when undefined_object then null; end $$;

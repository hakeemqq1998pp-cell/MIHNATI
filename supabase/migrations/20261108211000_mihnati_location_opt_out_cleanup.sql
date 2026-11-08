-- Ensure indexed user FK and clear both coordinates when either participant opts out.
create index if not exists mihnati_live_locations_user_id_idx on public.mihnati_live_locations(user_id);
drop index if exists public.mihnati_live_locations_updated_idx;

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
  delete from public.mihnati_live_locations where booking_id=p_booking_id;
 end if;
end; $$;

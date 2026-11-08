create or replace function private.mihnati_mark_arrived_at_location_impl(p_booking_id uuid)
returns public.mihnati_bookings language plpgsql security definer set search_path=''
as $$
declare b public.mihnati_bookings; j public.mihnati_jobs; l public.mihnati_live_locations; v_distance double precision;
begin
 if (select auth.uid()) is null then raise exception 'يجب تسجيل الدخول'; end if;
 select * into b from public.mihnati_bookings where id=p_booking_id for update;
 if not found or b.status<>'agreed' then raise exception 'الحجز غير نشط'; end if;
 if b.worker_id<>(select auth.uid()) then raise exception 'تأكيد الوصول التلقائي متاح للعامل فقط'; end if;
 if not b.worker_location_sharing or not b.owner_location_sharing then raise exception 'مشاركة الموقع من الطرفين مطلوبة'; end if;
 select * into j from public.mihnati_jobs where id=b.job_id;
 if j.latitude is null or j.longitude is null then raise exception 'لم يحدد صاحب العمل إحداثيات موقع العمل'; end if;
 select * into l from public.mihnati_live_locations where booking_id=b.id and user_id=b.worker_id;
 if not found or l.updated_at<now()-interval '2 minutes' then raise exception 'إحداثيات العامل غير حديثة'; end if;
 if l.accuracy_m is null or l.accuracy_m>50 then raise exception 'دقة GPS غير كافية لتأكيد الوصول تلقائياً'; end if;
 v_distance:=2*6371000*asin(least(1,sqrt(
  power(sin(radians((l.latitude-j.latitude)/2)),2)+
  cos(radians(j.latitude))*cos(radians(l.latitude))*power(sin(radians((l.longitude-j.longitude)/2)),2)
 )));
 if v_distance>100 then raise exception 'العامل لم يصل بعد إلى نطاق موقع العمل (100 متر)'; end if;
 update public.mihnati_bookings set arrived_at=coalesce(arrived_at,now()) where id=b.id returning * into b;
 return b;
end; $$;

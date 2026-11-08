-- Prevent a business account from publishing under a different business name.
drop policy if exists mihnati_jobs_insert_business on public.mihnati_jobs;
create policy mihnati_jobs_insert_business on public.mihnati_jobs for insert to authenticated
with check(
 owner_id=(select auth.uid()) and exists(
  select 1 from public.mihnati_profiles p
  where p.id=(select auth.uid()) and p.account_type='business'
    and p.business_type=mihnati_jobs.business_type
    and p.business_name=mihnati_jobs.business_name
 )
);

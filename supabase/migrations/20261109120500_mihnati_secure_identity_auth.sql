create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

alter table public.mihnati_profiles
  add column if not exists national_id_ciphertext text,
  add column if not exists national_id_hash text;

create unique index if not exists mihnati_profiles_national_id_hash_uidx
  on public.mihnati_profiles (national_id_hash)
  where national_id_hash is not null;

create table if not exists private.mihnati_auth_rate_limits (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);
revoke all on table private.mihnati_auth_rate_limits from public, anon, authenticated;
grant all on table private.mihnati_auth_rate_limits to service_role;

create or replace function public.mihnati_consume_auth_attempt(
  p_ip_hash text,
  p_limit integer default 8,
  p_window_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_attempts integer;
begin
  insert into private.mihnati_auth_rate_limits(ip_hash, window_started_at, attempts)
  values (p_ip_hash, now(), 1)
  on conflict (ip_hash) do update
  set window_started_at = case
        when private.mihnati_auth_rate_limits.window_started_at
             < now() - make_interval(secs => greatest(p_window_seconds, 60))
        then now() else private.mihnati_auth_rate_limits.window_started_at end,
      attempts = case
        when private.mihnati_auth_rate_limits.window_started_at
             < now() - make_interval(secs => greatest(p_window_seconds, 60))
        then 1 else private.mihnati_auth_rate_limits.attempts + 1 end
  returning attempts into v_attempts;
  return v_attempts <= greatest(p_limit, 1);
end;
$$;

revoke all on function public.mihnati_consume_auth_attempt(text, integer, integer) from public, anon, authenticated;
grant execute on function public.mihnati_consume_auth_attempt(text, integer, integer) to service_role;

drop policy if exists mihnati_profile_insert_self on public.mihnati_profiles;
create policy mihnati_profile_insert_self on public.mihnati_profiles
for insert to authenticated
with check (
  id = (select auth.uid())
  and account_type in ('worker'::public.mihnati_account_type, 'business'::public.mihnati_account_type)
  and national_id_hash is null
  and national_id_ciphertext is null
);

revoke update on table public.mihnati_profiles from authenticated;
grant update (phone, location_text, business_type, business_name)
  on table public.mihnati_profiles to authenticated;

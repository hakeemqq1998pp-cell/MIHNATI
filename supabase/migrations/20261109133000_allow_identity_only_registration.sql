-- Allow identity-only registration while retaining optional contact/location details.
alter table public.mihnati_profiles
  alter column phone drop not null,
  alter column location_text drop not null;

-- National identity fingerprints are keyed HMAC-SHA256 hex strings.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mihnati_profiles_national_id_hash_format'
      and conrelid = 'public.mihnati_profiles'::regclass
  ) then
    alter table public.mihnati_profiles
      add constraint mihnati_profiles_national_id_hash_format
      check (national_id_hash is null or national_id_hash ~ '^[0-9a-f]{64}$');
  end if;
end $$;

-- Keep profile identity fields server-managed; users may update only their contact details.
revoke update on table public.mihnati_profiles from authenticated;
grant update (phone, location_text, business_type, business_name)
  on table public.mihnati_profiles to authenticated;

-- Ensure the authentication throttle cannot be read or modified by public roles.
revoke all on table private.mihnati_auth_rate_limits from public, anon, authenticated;
grant all on table private.mihnati_auth_rate_limits to service_role;

create extension if not exists pgcrypto;
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,full_name text not null,phone text,role text not null check(role in('worker','employer')),city text,created_at timestamptz default now());
create table public.jobs(id uuid primary key default gen_random_uuid(),employer_id uuid not null references public.profiles(id) on delete cascade,title text not null,company_name text,category text not null,city text,salary_iqd bigint not null default 0 check(salary_iqd>=0),description text,status text not null default 'published' check(status in('published','closed')),created_at timestamptz default now());
create table public.applications(id uuid primary key default gen_random_uuid(),job_id uuid not null references public.jobs(id) on delete cascade,worker_id uuid not null references public.profiles(id) on delete cascade,status text not null default 'pending',created_at timestamptz default now(),unique(job_id,worker_id));
create table public.projects(id uuid primary key default gen_random_uuid(),seller_id uuid not null references public.profiles(id) on delete cascade,title text not null,category text not null,city text,price_iqd bigint not null check(price_iqd>0),phone text,description text,image_url text,status text not null default 'published' check(status in('published','sold','hidden')),created_at timestamptz default now());
create table public.videos(id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id) on delete cascade,video_url text not null,description text,status text not null default 'published' check(status in('published','hidden')),created_at timestamptz default now());
create table public.video_likes(video_id uuid references public.videos(id) on delete cascade,user_id uuid references public.profiles(id) on delete cascade,created_at timestamptz default now(),primary key(video_id,user_id));
create index jobs_created_idx on public.jobs(status,created_at desc);create index projects_created_idx on public.projects(status,created_at desc);create index videos_created_idx on public.videos(status,created_at desc);
create or replace function public.mihnati_new_user()
returns trigger language plpgsql security definer set search_path=public
as $function$
begin
  insert into public.profiles(id,full_name,phone,role)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name','عضو مهنتي'),new.raw_user_meta_data->>'phone','worker')
  on conflict(id) do nothing;
  return new;
end;
$function$;

create or replace function public.mihnati_lock_profile_role()
returns trigger language plpgsql set search_path=public
as $function$
begin
  if current_user not in ('postgres','service_role') then
    new.role := 'worker';
  end if;
  return new;
end;
$function$;
drop trigger if exists mihnati_lock_profile_role on public.profiles;
create trigger mihnati_lock_profile_role
before insert or update of role on public.profiles
for each row execute function public.mihnati_lock_profile_role();
drop trigger if exists mihnati_auth_user on auth.users;create trigger mihnati_auth_user after insert on auth.users for each row execute procedure public.mihnati_new_user();
alter table public.profiles enable row level security;alter table public.jobs enable row level security;alter table public.applications enable row level security;alter table public.projects enable row level security;alter table public.videos enable row level security;alter table public.video_likes enable row level security;
create policy "profile owner read" on public.profiles for select to authenticated using(id=auth.uid());create policy "profile insert self" on public.profiles for insert to authenticated with check(id=auth.uid());create policy "profile update self" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy "jobs public read" on public.jobs for select to anon,authenticated using(status='published' or employer_id=auth.uid());create policy "employer job insert" on public.jobs for insert to authenticated with check(employer_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and role='employer'));create policy "employer job update" on public.jobs for update to authenticated using(employer_id=auth.uid()) with check(employer_id=auth.uid());create policy "employer job delete" on public.jobs for delete to authenticated using(employer_id=auth.uid());
create policy "application parties read" on public.applications for select to authenticated using(worker_id=auth.uid() or exists(select 1 from public.jobs where jobs.id=job_id and employer_id=auth.uid()));create policy "worker apply" on public.applications for insert to authenticated with check(worker_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and role='worker'));create policy "worker withdraw" on public.applications for delete to authenticated using(worker_id=auth.uid());
create policy "projects public read" on public.projects for select to anon,authenticated using(status='published' or seller_id=auth.uid());create policy "project insert self" on public.projects for insert to authenticated with check(seller_id=auth.uid());create policy "project update self" on public.projects for update to authenticated using(seller_id=auth.uid()) with check(seller_id=auth.uid());create policy "project delete self" on public.projects for delete to authenticated using(seller_id=auth.uid());
create policy "videos public read" on public.videos for select to anon,authenticated using(status='published' or owner_id=auth.uid());create policy "video insert self" on public.videos for insert to authenticated with check(owner_id=auth.uid());create policy "video update self" on public.videos for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());create policy "video delete self" on public.videos for delete to authenticated using(owner_id=auth.uid());
create or replace function public.mihnati_video_like_counts() returns table(video_id uuid,likes_count bigint) language sql stable security definer set search_path=public as $ select v.id,count(l.user_id) from public.videos v left join public.video_likes l on l.video_id=v.id where v.status='published' group by v.id $; grant execute on function public.mihnati_video_like_counts() to anon,authenticated;create policy "like owner read" on public.video_likes for select to authenticated using(user_id=auth.uid());create policy "like self" on public.video_likes for insert to authenticated with check(user_id=auth.uid());create policy "unlike self" on public.video_likes for delete to authenticated using(user_id=auth.uid());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('project-images','project-images',true,5242880,array['image/jpeg','image/png','image/webp']),('work-videos','work-videos',true,52428800,array['video/mp4','video/webm','video/quicktime']) on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "read project images" on storage.objects for select to anon,authenticated using(bucket_id='project-images');create policy "upload own project images" on storage.objects for insert to authenticated with check(bucket_id='project-images' and (storage.foldername(name))[1]=auth.uid()::text);create policy "read videos" on storage.objects for select to anon,authenticated using(bucket_id='work-videos');create policy "upload own videos" on storage.objects for insert to authenticated with check(bucket_id='work-videos' and (storage.foldername(name))[1]=auth.uid()::text);create policy "delete own videos" on storage.objects for delete to authenticated using(bucket_id='work-videos' and (storage.foldername(name))[1]=auth.uid()::text);
revoke execute on function public.mihnati_new_user() from public, anon, authenticated;
create index if not exists applications_worker_id_idx on public.applications(worker_id);
create index if not exists jobs_employer_id_idx on public.jobs(employer_id);
create index if not exists projects_seller_id_idx on public.projects(seller_id);
create index if not exists video_likes_user_id_idx on public.video_likes(user_id);
create index if not exists videos_owner_id_idx on public.videos(owner_id);

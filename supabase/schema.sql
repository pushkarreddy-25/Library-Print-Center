-- Library Print Center production schema
create extension if not exists pgcrypto;

create type public.user_role as enum ('student', 'operator', 'admin');
create type public.account_status as enum ('active', 'disabled');
create type public.print_job_status as enum ('uploaded', 'waiting', 'printing', 'completed', 'cancelled', 'failed');
create type public.color_mode as enum ('bw', 'color');
create type public.print_sides as enum ('single', 'double');
create type public.print_orientation as enum ('auto', 'portrait', 'landscape');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  role public.user_role not null default 'student',
  print_code text unique,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_print_code_shape check (print_code is null or print_code ~ '^[A-HJ-NP-Z2-9]{6}$')
);

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  file_type text not null,
  file_size bigint not null,
  page_count integer not null default 1 check (page_count > 0),
  copies integer not null default 1 check (copies between 1 and 100),
  color_mode public.color_mode not null default 'bw',
  paper_size text not null default 'A4',
  sides public.print_sides not null default 'single',
  orientation public.print_orientation not null default 'auto',
  page_range text,
  status public.print_job_status not null default 'uploaded',
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table public.printers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  system_name text not null unique,
  status text not null default 'offline',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.print_logs (
  id uuid primary key default gen_random_uuid(),
  print_job_id uuid not null references public.print_jobs(id) on delete cascade,
  operator_id uuid references public.profiles(id) on delete set null,
  printer_id uuid references public.printers(id) on delete set null,
  action text not null,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index print_jobs_user_status_idx on public.print_jobs(user_id, status, created_at desc);
create index print_jobs_queue_idx on public.print_jobs(status, created_at asc);
create index profiles_print_code_idx on public.profiles(print_code);

create or replace function public.generate_print_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where print_code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, phone, print_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', 'New student'),
    new.email,
    new.phone,
    public.generate_print_code()
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Repair auth users created before this schema was installed.
insert into public.profiles (id, name, email, phone, print_code)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'name', 'New student'),
  users.email,
  users.phone,
  public.generate_print_code()
from auth.users as users
where not exists (
  select 1 from public.profiles as profiles where profiles.id = users.id
);

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('operator', 'admin') and status = 'active'
  );
$$;

alter table public.profiles enable row level security;
alter table public.print_jobs enable row level security;
alter table public.printers enable row level security;
alter table public.print_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'print_jobs'
  ) then
    alter publication supabase_realtime add table public.print_jobs;
  end if;
end;
$$;

create policy "users read their own profile" on public.profiles for select using (id = auth.uid() or public.is_staff());
create policy "users update their own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "staff manage profiles" on public.profiles for all using (public.is_staff()) with check (public.is_staff());

create policy "students read their own jobs" on public.print_jobs for select using (user_id = auth.uid() or public.is_staff());
create policy "students create their own jobs" on public.print_jobs for insert with check (user_id = auth.uid());
create policy "students cancel their own jobs" on public.print_jobs for update using (user_id = auth.uid() or public.is_staff()) with check (user_id = auth.uid() or public.is_staff());
create policy "staff delete jobs" on public.print_jobs for delete using (public.is_staff());

create policy "staff manage printers" on public.printers for all using (public.is_staff()) with check (public.is_staff());
create policy "staff read logs" on public.print_logs for select using (public.is_staff());
create policy "staff create logs" on public.print_logs for insert with check (public.is_staff());

insert into storage.buckets (id, name, public)
values ('print-documents', 'print-documents', false)
on conflict (id) do nothing;

create policy "students upload their own documents" on storage.objects for insert to authenticated
with check (bucket_id = 'print-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "students read their own documents" on storage.objects for select to authenticated
using (bucket_id = 'print-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));
create policy "students delete their own documents" on storage.objects for delete to authenticated
using (bucket_id = 'print-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));

create or replace function public.cleanup_expired_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count integer;
begin
  delete from public.print_jobs
  where expires_at < now() and status in ('completed', 'cancelled', 'failed');
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create table if not exists public.rb_rooting_records (
  id uuid primary key,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  saved_date text,
  saved_time text,
  week_code text,
  form jsonb not null default '{}'::jsonb,
  score numeric not null default 0,
  percent numeric not null default 0,
  summary jsonb not null default '{}'::jsonb
);

alter table public.rb_rooting_records enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.rb_rooting_records to authenticated;

drop policy if exists "rb_rooting_records_select" on public.rb_rooting_records;
drop policy if exists "rb_rooting_records_insert" on public.rb_rooting_records;
drop policy if exists "rb_rooting_records_update" on public.rb_rooting_records;
drop policy if exists "rb_rooting_records_delete" on public.rb_rooting_records;

create policy "rb_rooting_records_select"
on public.rb_rooting_records
for select
to authenticated
using (true);

create policy "rb_rooting_records_insert"
on public.rb_rooting_records
for insert
to authenticated
with check (true);

create policy "rb_rooting_records_update"
on public.rb_rooting_records
for update
to authenticated
using (true)
with check (true);

create policy "rb_rooting_records_delete"
on public.rb_rooting_records
for delete
to authenticated
using (true);

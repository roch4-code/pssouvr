begin;

create table if not exists public.store_stamps (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  image text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_stamps enable row level security;
grant select on public.store_stamps to anon, authenticated;
grant insert, update, delete on public.store_stamps to authenticated;
create index if not exists store_stamps_active_sort_idx on public.store_stamps (active, sort_order);

do $policies$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='store_stamps' and policyname='Anyone can read active stamps') then
    execute $policy$ create policy "Anyone can read active stamps" on public.store_stamps for select to anon, authenticated using (active is true) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='store_stamps' and policyname='Admins can read all stamps') then
    execute $policy$ create policy "Admins can read all stamps" on public.store_stamps for select to authenticated using (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='store_stamps' and policyname='Admins can add stamps') then
    execute $policy$ create policy "Admins can add stamps" on public.store_stamps for insert to authenticated with check (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='store_stamps' and policyname='Admins can update stamps') then
    execute $policy$ create policy "Admins can update stamps" on public.store_stamps for update to authenticated using (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) with check (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='store_stamps' and policyname='Admins can delete stamps') then
    execute $policy$ create policy "Admins can delete stamps" on public.store_stamps for delete to authenticated using (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
end
$policies$;

insert into public.store_stamps (slug,name,image,sort_order,active) values
  ('anti-sistema-club','Anti Sistema Club','estampa-anti-sistema-club.png',0,true),
  ('deus','Deus é o Juiz','estampa-deus-e-o-juiz.png',1,true)
on conflict (slug) do nothing;

commit;

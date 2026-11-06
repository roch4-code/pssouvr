-- DEUS É O JUIZ: Supabase para Auth, catálogo e resumo dos pedidos.
-- Não armazene CPF, telefone, CEP ou endereço nestas tabelas.
-- Execute no SQL Editor do projeto Supabase jioxcxezhgdffsjufejc.

begin;

create table if not exists public.products (
  slug text primary key,
  name text not null,
  category text not null,
  stamp text,
  price numeric(10,2) not null check (price >= 0),
  old_price numeric(10,2) check (old_price is null or old_price >= 0),
  sizes jsonb not null default '[]'::jsonb,
  colors jsonb not null default '[]'::jsonb,
  tag text,
  description text not null default '',
  image text not null default '',
  images jsonb not null default '[]'::jsonb,
  source_url text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.products add column if not exists images jsonb not null default '[]'::jsonb;

create table if not exists public.store_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Somente dados operacionais não sensíveis. Os dados pessoais ficam cifrados no Neon.
create table if not exists public.order_summaries (
  order_id uuid primary key,
  request_id uuid not null unique,
  user_id uuid references auth.users(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10,2) not null check (subtotal >= 0),
  status text not null default 'Aguardando confirmação de frete e pagamento',
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;
alter table public.store_admins enable row level security;
alter table public.order_summaries enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.store_admins to authenticated;
grant select on public.order_summaries to authenticated;
revoke all on public.order_summaries from anon;
revoke insert, update, delete on public.order_summaries from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('product-images', 'product-images', true, 1073741824)
on conflict (id) do update set public = true, file_size_limit = 1073741824;

do $policies$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='store_admins' and policyname='Admins can read their own membership') then
    execute $policy$ create policy "Admins can read their own membership" on public.store_admins for select to authenticated using ((select auth.uid()) = user_id) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='Anyone can read active products') then
    execute $policy$ create policy "Anyone can read active products" on public.products for select to anon, authenticated using (active is true) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='Store admins can read all products') then
    execute $policy$ create policy "Store admins can read all products" on public.products for select to authenticated using (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='Store admins can insert products') then
    execute $policy$ create policy "Store admins can insert products" on public.products for insert to authenticated with check (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='Store admins can update products') then
    execute $policy$ create policy "Store admins can update products" on public.products for update to authenticated using (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) with check (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='Store admins can delete products') then
    execute $policy$ create policy "Store admins can delete products" on public.products for delete to authenticated using (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Public can read product images') then
    execute $policy$ create policy "Public can read product images" on storage.objects for select to anon, authenticated using (bucket_id = 'product-images') $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Store admins can upload product images') then
    execute $policy$ create policy "Store admins can upload product images" on storage.objects for insert to authenticated with check (bucket_id = 'product-images' and exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Store admins can update product images') then
    execute $policy$ create policy "Store admins can update product images" on storage.objects for update to authenticated using (bucket_id = 'product-images' and exists (select 1 from public.store_admins where user_id = (select auth.uid()))) with check (bucket_id = 'product-images' and exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Store admins can delete product images') then
    execute $policy$ create policy "Store admins can delete product images" on storage.objects for delete to authenticated using (bucket_id = 'product-images' and exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_summaries' and policyname='Customers can read their own order summaries') then
    execute $policy$ create policy "Customers can read their own order summaries" on public.order_summaries for select to authenticated using (user_id = (select auth.uid())) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_summaries' and policyname='Store admins can read order summaries') then
    execute $policy$ create policy "Store admins can read order summaries" on public.order_summaries for select to authenticated using (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
end
$policies$;

create index if not exists products_active_sort_idx on public.products (active, sort_order);
create index if not exists order_summaries_user_created_idx on public.order_summaries (user_id, created_at desc);

-- Se a conta de admin já existir, ela será associada. Se ainda não existir,
-- execute o INSERT ao final depois de criar a conta em Authentication > Users.
insert into public.store_admins (user_id)
select id from auth.users where lower(email) = lower('roch4v4@gmail.com')
on conflict (user_id) do nothing;

commit;

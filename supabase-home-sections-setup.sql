-- Configuração pública da página inicial.
-- Visitantes podem ler os títulos e listas de produtos; somente membros de
-- public.store_admins podem criar ou alterar as seções editáveis.

begin;

create table if not exists public.home_sections (
  section_key text primary key check (section_key in ('women', 'featured', 'news')),
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 240),
  product_slugs jsonb not null default '[]'::jsonb check (jsonb_typeof(product_slugs) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.home_sections enable row level security;

grant select on public.home_sections to anon, authenticated;
grant insert, update on public.home_sections to authenticated;

drop policy if exists "Homepage sections are public" on public.home_sections;
create policy "Homepage sections are public"
  on public.home_sections for select
  to anon, authenticated
  using (true);

drop policy if exists "Store admins manage homepage sections" on public.home_sections;
create policy "Store admins manage homepage sections"
  on public.home_sections for all
  to authenticated
  using (exists (
    select 1 from public.store_admins
    where store_admins.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.store_admins
    where store_admins.user_id = (select auth.uid())
  ));

commit;

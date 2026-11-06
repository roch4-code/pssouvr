-- Migração não destrutiva para um projeto Supabase já existente.
-- Cria a tabela nova de resumos sem nome, CPF, e-mail, telefone ou endereço.
-- A tabela legada public.orders, se existir, permanece intacta; não apague os dados
-- antigos sem antes exportar/migrar e confirmar a retenção necessária.

begin;

create table if not exists public.order_summaries (
  order_id uuid primary key,
  request_id uuid not null unique,
  user_id uuid references auth.users(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10,2) not null check (subtotal >= 0),
  status text not null default 'Aguardando confirmação de frete e pagamento',
  notification_status text not null default 'pending',
  notification_error text,
  created_at timestamptz not null default now()
);

alter table public.order_summaries enable row level security;
grant usage on schema public to authenticated;
grant select on public.order_summaries to authenticated;
revoke all on public.order_summaries from anon;
revoke insert, update, delete on public.order_summaries from anon, authenticated;

do $policies$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_summaries' and policyname='Customers can read their own order summaries') then
    execute $policy$ create policy "Customers can read their own order summaries" on public.order_summaries for select to authenticated using (user_id = (select auth.uid())) $policy$;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='order_summaries' and policyname='Store admins can read order summaries') then
    execute $policy$ create policy "Store admins can read order summaries" on public.order_summaries for select to authenticated using (exists (select 1 from public.store_admins where user_id = (select auth.uid()))) $policy$;
  end if;
end
$policies$;

create index if not exists order_summaries_user_created_idx on public.order_summaries (user_id, created_at desc);
commit;

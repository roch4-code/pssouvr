-- Execute no SQL Editor do NOVO projeto Neon (deus-e-o-juiz-novo).
-- Neon guarda somente o payload pessoal do pedido, cifrado pela API no Render.
-- Não rode os SQLs antigos de catálogo/pedidos da Neon.

begin;

create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.customer_sensitive_orders (
  order_id uuid primary key,
  user_id uuid,
  payload_ciphertext bytea not null,
  payload_iv bytea not null,
  payload_auth_tag bytea not null,
  encryption_version smallint not null default 1 check (encryption_version = 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table private.customer_sensitive_orders is
  'Dados pessoais de pedidos cifrados por AES-256-GCM no serviço Render. Não gravar dados em texto puro.';
comment on column private.customer_sensitive_orders.user_id is
  'UUID do usuário autenticado no Supabase, quando houver. Não é dado de login armazenado no Neon.';

revoke all on all tables in schema private from public;
revoke all on all sequences in schema private from public;

-- Crie primeiro o papel dej_render_app em Neon > Roles. Depois rode este bloco
-- novamente para conceder a ele apenas acesso à tabela de dados cifrados.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'dej_render_app') then
    execute 'grant usage on schema private to dej_render_app';
    execute 'grant select, insert, update on private.customer_sensitive_orders to dej_render_app';
  end if;
end
$$;

commit;


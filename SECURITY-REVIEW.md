# Revisão de segurança — 04/11/2026

## Revisão feita no código local

- Checkout envia dados pessoais direto ao Render; o antigo endpoint Supabase `submit-order` retorna HTTP 410 e não aceita pedidos.
- Render valida CPF, e-mail, CEP, UUID, itens e disponibilidade/preço no catálogo público do Supabase.
- CPF, nome, telefone, e-mail de contato e endereço são cifrados no Render com AES-256-GCM antes de serem gravados no Neon. A chave de cifra é uma variável de ambiente separada.
- Supabase guarda o resumo operacional do pedido; os campos pessoais ficam cifrados no Neon e são unidos no painel apenas por uma rota administrativa protegida.
- Consulta de dados privados requer token Supabase válido e autoriza apenas o dono do pedido ou o admin (email configurado + membership em `store_admins`).
- SQL de catálogo e resumos habilita RLS; alterações no catálogo exigem associação administrativa. A chave `service_role` aparece somente como variável server-side no Render Blueprint.
- API aplica limites de tamanho, validação de origem, limite por IP em memória, respostas `no-store`, headers de segurança e queries parametrizadas. Logs não incluem o conteúdo das requisições.

## Verificações executadas

- `node --check render-api/server.mjs`: aprovado.
- Revisão estática dos arquivos de backend, SQL e fluxo de checkout.
- Strix não foi executado: Docker e CLI Strix não estão instalados neste ambiente. A revisão manual não substitui SAST/DAST/penetration testing.

## Bloqueios antes de produção

1. Criar no Neon o papel `dej_render_app` com privilégio mínimo e usar sua connection string no Render; não usar `neondb_owner`.
2. Criar/ configurar o serviço Render com as chaves privadas e a origem pública correta.
3. Aplicar `supabase-setup.sql`, associar a conta admin e revisar Auth/redirects no Supabase.
4. Esta versão não escreve mais em uma planilha Google. Um arquivo antigo no Drive não é apagado pelo deploy; revise e remova manualmente se não precisar preservá-lo.
5. Rodar Strix após instalar Docker e configurar um provedor de modelo; revisar qualquer achado antes da publicação.

Esta verificação é um checkpoint de desenvolvimento, não certificação ou garantia de segurança.

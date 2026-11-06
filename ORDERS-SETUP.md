# Pedidos e dados privados

O navegador envia o formulário para a API no Render. A API valida o catálogo e o preço atual no Supabase, cifra os campos pessoais com AES-256-GCM e grava o conteúdo cifrado no schema privado do Neon. O resumo com itens e subtotal fica em `public.order_summaries`. No painel administrativo, a aba **Planilha de pedidos** combina os dois bancos para mostrar os dados completos somente depois da validação de administrador. Não há integração com Google Sheets.

## Configuração

1. Execute `neon-sensitive-setup.sql` no projeto Neon novo.
2. Crie um papel de banco exclusivo para a aplicação seguindo `render-api/NEON-APP-ROLE.sql`. Não use o papel owner em produção.
3. Publique `supabase-setup.sql` no projeto Supabase e configure a conta de administrador conforme `ADMIN-SETUP.md`.
4. Crie o serviço do Render usando `render.yaml` e o diretório `render-api/`.
5. Configure no Render: `DATABASE_URL` do papel limitado; `DATA_ENCRYPTION_KEY` como chave aleatória de 32 bytes codificada em Base64; `SUPABASE_SERVICE_ROLE_KEY`/secret key do projeto (somente servidor); `ALLOWED_ORIGINS` com a origem exata do site (por exemplo `https://roch4-code.github.io`, sem o caminho do repositório).
6. Depois de criado o serviço, atualize `privateApiUrl` em `backend-config.js` para o domínio Render real. A URL ali é pública; segredos ficam apenas no Render.
7. No serviço Render já existente, remova as variáveis antigas `GOOGLE_SHEETS_WEBHOOK_URL` e `GOOGLE_SHEETS_WEBHOOK_SECRET`. Esta versão não as usa. O arquivo externo de planilha e os dados antigos não são apagados pelo deploy; arquive ou exclua esse arquivo manualmente se quiser removê-lo também.

`DATA_ENCRYPTION_KEY` pode ser gerada com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Guarde uma cópia segura fora do repositório: perder essa chave torna os dados cifrados irrecuperáveis. Nunca a envie no chat ou no GitHub.

A consulta dos dados privados exige sessão Supabase. A aba Planilha do painel exige também que o usuário seja o administrador configurado e esteja registrado em `store_admins`; o Render valida essa permissão em cada consulta e alteração. A API não registra corpos das requisições em logs. O fluxo não calcula frete e não cobra o cliente.

O painel é ocultado até o login administrador; mesmo que alguém descubra a URL da API, o servidor exige sessão válida, e-mail confirmado, e-mail administrador e associação em `store_admins` em cada leitura, alteração de status ou exclusão. As respostas da API usam `no-store` para evitar cache dos dados pessoais. Os dados pessoais são cifrados no Neon e só o serviço do Render possui a chave de decifragem.

As etapas Empacotado, Enviado e Recebeu são salvas no resumo do Supabase e aparecem na tabela do painel. Pagamento e rastreio ainda são exibidos como não informados enquanto esses recursos não estiverem integrados. O administrador pode excluir um pedido ou selecionar vários; a confirmação remove o resumo do Supabase e os dados pessoais cifrados do Neon. Uma vez por mês, o painel lembra de revisar pedidos com mais de 90 dias; nada é excluído sem seleção e confirmação explícitas. A tabela antiga `public.orders` não é migrada automaticamente.


# Exclusão de conta

A exclusão de conta valida a sessão e a senha recente pelo Supabase. A API privada remove os dados pessoais cifrados do Neon, os resumos de pedidos do Supabase e, por último, a conta do Supabase Auth. Não depende de Google Sheets.

Antes do deploy, aplique `render-api/NEON-ACCOUNT-DELETE.sql` no Neon para conceder ao papel técnico do Render a permissão de exclusão necessária. Mantenha `DATABASE_URL`, `DATA_ENCRYPTION_KEY` e `SUPABASE_SERVICE_ROLE_KEY` somente nas variáveis protegidas do Render; não publique esses segredos no GitHub.

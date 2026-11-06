# Conta de administrador

O login é do **Supabase Auth**. A autorização do painel também exige o e-mail `roch4v4@gmail.com` e associação em `public.store_admins`; o e-mail sozinho não concede acesso.

1. Publique o SQL `supabase-setup.sql` no SQL Editor do projeto Supabase.
2. Confirme o cadastro do e-mail de administrador em **Authentication → Users**. Se ainda não existir, cadastre pelo site e confirme a mensagem de e-mail.
3. Execute novamente o trecho de associação de administrador no fim do SQL. Ele associa a conta existente pelo e-mail.
4. O catálogo e as fotos do painel usam Supabase Database e Supabase Storage. O Neon não participa do login nem do catálogo.

A chave `sb_publishable_...` no `backend-config.js` é pública. Nunca coloque no site a chave `service_role`, senha do banco, connection string ou chave de criptografia.

# Arquitetura da loja

- **Supabase Auth:** cadastro, confirmação de e-mail, login e sessão.
- **Supabase Database/Storage:** catálogo, permissões de administrador e resumos de pedidos sem dados pessoais.
- **Render:** API privada para validar o pedido e intermediar a gravação.
- **Neon:** somente dados pessoais sensíveis do pedido, cifrados com AES-256-GCM antes de gravar (CPF, endereço, telefone, nome e e-mail de contato).
- **Pedidos no painel:** o painel administrativo reúne o resumo do Supabase e os dados cifrados do Neon somente para a conta autorizada. Não usa uma planilha externa.

Não há cobrança de pagamento nem cálculo de frete integrado nesta versão.

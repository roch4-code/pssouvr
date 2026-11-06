-- Aplique no Neon se o papel do Render já estava criado antes desta versão.
-- Isso permite à API apagar apenas os dados cifrados associados a uma conta.
grant delete on table private.customer_sensitive_orders to dej_render_app;

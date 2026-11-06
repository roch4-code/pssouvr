-- Run this only after creating the dedicated `dej_render_app` role
-- in Neon Console > Roles. Set its password in Neon, then store its
-- connection string as Render DATABASE_URL. Do not use the owner role.
revoke all on schema private from public;
revoke all on table private.customer_sensitive_orders from public;
grant usage on schema private to dej_render_app;
grant select, insert, update, delete on table private.customer_sensitive_orders to dej_render_app;

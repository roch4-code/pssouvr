import { createServer } from 'node:http';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const port = Number(process.env.PORT || 10000);
const databaseUrl = process.env.DATABASE_URL || '';
const encryptionKey = Buffer.from(process.env.DATA_ENCRYPTION_KEY || '', 'base64');
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean));
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 }) : null;
const rateBuckets = new Map();

function send(res, status, body, origin = '') {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'strict-transport-security': 'max-age=31536000; includeSubDomains'
  };
  if (origin && allowedOrigins.has(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'Origin';
    headers['access-control-allow-headers'] = 'authorization, content-type';
    headers['access-control-allow-methods'] = 'GET, POST, PATCH, OPTIONS';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function validUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validCpf(cpf) {
  const digits = String(cpf || '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits) || /^([0-9])\1{10}$/.test(digits)) return false;
  const check = length => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    const remainder = (sum * 10) % 11;
    return (remainder === 10 ? 0 : remainder) === Number(digits[length]);
  };
  return check(9) && check(10);
}

function rateLimit(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
  const ip = forwarded.at(-1) || String(req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  const current = rateBuckets.get(ip);
  if (!current || now - current.start > 60_000) rateBuckets.set(ip, { start: now, count: 1 });
  else if (++current.count > 60) return false;
  if (rateBuckets.size > 5000) for (const [key, value] of rateBuckets) if (now - value.start > 120_000) rateBuckets.delete(key);
  return true;
}

async function readJson(req, maxBytes = 48 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Payload muito grande.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}

function normalizedCustomer(input) {
  const value = input && typeof input === 'object' ? input : {};
  const clean = (key, limit) => typeof value[key] === 'string' ? value[key].trim().slice(0, limit) : '';
  const customer = {
    name: clean('name', 120), email: clean('email', 200).toLowerCase(), phone: clean('phone', 40),
    cpf: clean('cpf', 14).replace(/\D/g, ''), postalCode: clean('postalCode', 9).replace(/\D/g, ''),
    address: clean('address', 180), addressExtra: clean('addressExtra', 120), cityState: clean('cityState', 120)
  };
  if (!validCpf(customer.cpf) || customer.name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) || customer.phone.replace(/\D/g, '').length < 10 ||
      customer.postalCode.length !== 8 || customer.address.length < 3 || customer.cityState.length < 3) {
    throw Object.assign(new Error(!validCpf(customer.cpf) ? 'Informe um CPF válido.' : 'Confira os dados de contato e entrega.'), { status: 400 });
  }
  return customer;
}

function encryptJson(value) {
  const iv = cryptoRandomIv();
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { encrypted, iv, tag: cipher.getAuthTag() };
}

function decryptJson(ciphertext, iv, tag) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

function cryptoRandomIv() { return randomBytes(12); }

async function verifySupabaseUser(token) {
  if (!supabaseUrl || !supabaseKey) throw new Error('Autenticação do Supabase não configurada no serviço.');
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseKey, authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  return response.json();
}

async function isAdmin(user, token) {
  if (!user?.id || String(user.email || '').toLowerCase() !== adminEmail) return false;
  const url = new URL(`${supabaseUrl}/rest/v1/store_admins`);
  url.searchParams.set('select', 'user_id');
  url.searchParams.set('user_id', `eq.${user.id}`);
  url.searchParams.set('limit', '1');
  const response = await fetch(url, { headers: { apikey: supabaseKey, authorization: `Bearer ${token}` } });
  if (!response.ok) return false;
  const rows = await response.json();
  return Array.isArray(rows) && rows.some(row => row.user_id === user.id);
}

function decodeJwtPayload(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); }
  catch { return null; }
}

async function supabaseAdminRequest(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: supabaseServiceKey,
      authorization: `Bearer ${supabaseServiceKey}`,
      ...(options.headers || {})
    }
  });
  return response;
}

async function eraseAccountData(user) {
  if (!pool || !databaseUrl || !supabaseServiceKey || !supabaseUrl) throw new Error('Exclusão segura indisponível: os serviços de dados não estão configurados.');
  const summariesUrl = new URL(`${supabaseUrl}/rest/v1/order_summaries`);
  summariesUrl.searchParams.set('select', 'order_id');
  summariesUrl.searchParams.set('user_id', `eq.${user.id}`);
  summariesUrl.searchParams.set('limit', '10000');
  const summariesResponse = await supabaseAdminRequest(`${summariesUrl.pathname}${summariesUrl.search}`);
  if (!summariesResponse.ok) throw new Error('Não foi possível localizar com segurança os pedidos da conta. Nenhuma conta foi removida.');
  const summaries = await summariesResponse.json();
  const orderIds = [...new Set((Array.isArray(summaries) ? summaries : []).map(row => String(row.order_id || '')).filter(validUuid))];

  const connection = await pool.connect();
  try {
    await connection.query('begin');
    await connection.query('delete from private.customer_sensitive_orders where user_id = $1::uuid or order_id = any($2::uuid[])', [user.id, orderIds]);
    await connection.query('commit');
  } catch (error) {
    await connection.query('rollback').catch(() => {});
    throw new Error('Não foi possível apagar os dados pessoais cifrados. A conta permanece ativa; tente novamente.');
  } finally {
    connection.release();
  }

  const summaryDelete = await supabaseAdminRequest(`/rest/v1/order_summaries?user_id=eq.${encodeURIComponent(user.id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (!summaryDelete.ok) throw new Error('Não foi possível remover o histórico da conta no Supabase. A conta permanece ativa; tente novamente.');

  const authDelete = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
    method: 'DELETE',
    headers: { apikey: supabaseServiceKey, authorization: `Bearer ${supabaseServiceKey}` }
  });
  if (!authDelete.ok) throw new Error('Os pedidos foram removidos, mas o Supabase não confirmou a exclusão da conta. Entre novamente e tente excluir mais uma vez.');
  return { deletedOrders: orderIds.length };
}
const orderStatuses = new Set(['Aguardando confirmação de frete e pagamento', 'Empacotado', 'Enviado', 'Recebeu']);

async function requireAdminRequest(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Entre com a conta administradora.', status: 401 };
  const user = await verifySupabaseUser(token);
  if (!user?.id) return { error: 'Sessão inválida. Entre novamente.', status: 401 };
  if (!user.email_confirmed_at && !user.confirmed_at) return { error: 'Confirme o e-mail administrador antes de acessar os pedidos.', status: 403 };
  if (!(await isAdmin(user, token))) return { error: 'Acesso restrito à equipe administradora.', status: 403 };
  return { user, token };
}

async function listAdminOrders() {
  if (!supabaseServiceKey || !pool || !databaseUrl) throw new Error('A consulta de pedidos não está configurada no serviço privado.');
  const response = await supabaseAdminRequest('/rest/v1/order_summaries?select=order_id,created_at,status,items,subtotal,user_id&order=created_at.desc&limit=1000');
  if (!response.ok) throw new Error('Não foi possível carregar os pedidos.');
  const summaries = await response.json();
  const ids = summaries.map(row => String(row.order_id || '')).filter(validUuid);
  const sensitiveRows = ids.length ? (await pool.query(`select order_id, payload_ciphertext, payload_iv, payload_auth_tag from private.customer_sensitive_orders where order_id = any($1::uuid[])`, [ids])).rows : [];
  const sensitiveById = new Map();
  for (const row of sensitiveRows) {
    try { sensitiveById.set(row.order_id, decryptJson(row.payload_ciphertext, row.payload_iv, row.payload_auth_tag)); }
    catch { sensitiveById.set(row.order_id, null); }
  }
  return summaries.map(row => ({
    orderId: row.order_id,
    createdAt: row.created_at,
    status: row.status,
    items: Array.isArray(row.items) ? row.items : [],
    subtotal: Number(row.subtotal || 0),
    customer: sensitiveById.get(row.order_id) || null
  }));
}
async function handle(req, res) {
  const origin = String(req.headers.origin || '');
  if (req.method === 'OPTIONS') return send(res, allowedOrigins.has(origin) ? 200 : 403, {}, origin);
  if (!rateLimit(req)) return send(res, 429, { error: 'Muitas solicitações. Tente novamente em instantes.' });
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
  if ((req.method === 'GET' && url.pathname === '/api/admin/orders') || (req.method === 'POST' && url.pathname === '/api/admin/orders/delete') || (req.method === 'PATCH' && /^\/api\/admin\/orders\/[0-9a-f-]+\/status$/i.test(url.pathname))) {
    if (!supabaseUrl || !supabaseKey || !supabaseServiceKey || !databaseUrl || !pool) return send(res, 503, { error: 'A consulta administrativa ainda não está configurada.' }, origin);
    if (origin && !allowedOrigins.has(origin)) return send(res, 403, { error: 'Origem não autorizada.' }, origin);
    try {
      const access = await requireAdminRequest(req);
      if (access.error) return send(res, access.status, { error: access.error }, origin);
      if (req.method === 'GET') return send(res, 200, { ok: true, orders: await listAdminOrders() }, origin);
      if (req.method === 'POST') {
        const body = await readJson(req, 64 * 1024);
        const requestedIds = Array.isArray(body?.orderIds) ? [...new Set(body.orderIds.map(String))] : [];
        if (!requestedIds.length || requestedIds.length > 1000 || requestedIds.some(id => !validUuid(id))) return send(res, 400, { error: 'Selecione de 1 a 1000 pedidos válidos para excluir.' }, origin);
        const lookup = new URL(`${supabaseUrl}/rest/v1/order_summaries`);
        lookup.searchParams.set('select', 'order_id');
        lookup.searchParams.set('order_id', `in.(${requestedIds.join(',')})`);
        const lookupResponse = await supabaseAdminRequest(`${lookup.pathname}${lookup.search}`);
        if (!lookupResponse.ok) return send(res, 503, { error: 'Não foi possível confirmar os pedidos selecionados.' }, origin);
        const existingRows = await lookupResponse.json();
        const existingIds = [...new Set((Array.isArray(existingRows) ? existingRows : []).map(row => String(row.order_id)).filter(validUuid))];
        if (!existingIds.length) return send(res, 404, { error: 'Os pedidos selecionados não foram encontrados.' }, origin);
        const connection = await pool.connect();
        try {
          await connection.query('begin');
          await connection.query('delete from private.customer_sensitive_orders where order_id = any($1::uuid[])', [existingIds]);
          await connection.query('commit');
        } catch {
          await connection.query('rollback').catch(() => {});
          return send(res, 503, { error: 'Não foi possível excluir os dados pessoais cifrados. Nenhum resumo foi apagado.' }, origin);
        } finally { connection.release(); }
        const remove = new URL(`${supabaseUrl}/rest/v1/order_summaries`);
        remove.searchParams.set('order_id', `in.(${existingIds.join(',')})`);
        const removeResponse = await supabaseAdminRequest(`${remove.pathname}${remove.search}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        if (!removeResponse.ok) return send(res, 503, { error: 'Os dados pessoais foram apagados; não foi possível apagar o resumo. Atualize a lista e tente novamente.' }, origin);
        return send(res, 200, { ok: true, deleted: existingIds.length }, origin);
      }
      const match = url.pathname.match(/^\/api\/admin\/orders\/([0-9a-f-]+)\/status$/i);
      const orderId = match?.[1] || '';
      if (!validUuid(orderId)) return send(res, 400, { error: 'Número de pedido inválido.' }, origin);
      const body = await readJson(req, 4096);
      const status = String(body?.status || '');
      if (!orderStatuses.has(status)) return send(res, 400, { error: 'Etapa de pedido inválida.' }, origin);
      const statusResponse = await supabaseAdminRequest(`/rest/v1/order_summaries?order_id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ status })
      });
      const updatedRows = statusResponse.ok ? await statusResponse.json().catch(() => []) : [];
      if (!statusResponse.ok || !Array.isArray(updatedRows) || !updatedRows.length) return send(res, statusResponse.ok ? 404 : 503, { error: 'Não foi possível atualizar a etapa do pedido.' }, origin);
      return send(res, 200, { ok: true, orderId, status }, origin);
    } catch (error) {
      return send(res, 503, { error: error.message || 'Não foi possível acessar os pedidos administrativos.' }, origin);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/account/delete') {
    if (!supabaseUrl || !supabaseKey || !supabaseServiceKey || !databaseUrl || !pool) return send(res, 503, { error: 'O serviço de exclusão segura ainda não está configurado.' }, origin);
    if (origin && !allowedOrigins.has(origin)) return send(res, 403, { error: 'Origem não autorizada.' }, origin);
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return send(res, 401, { error: 'Entre novamente para excluir sua conta.' }, origin);
    try {
      const claims = decodeJwtPayload(token);
      const authTime = Number(claims?.auth_time || 0);
      const age = Math.floor(Date.now() / 1000) - authTime;
      if (!claims?.sub || !authTime || age < -30 || age > 300) return send(res, 403, { error: 'Por segurança, confirme sua senha novamente e tente de novo.' }, origin);
      const user = await verifySupabaseUser(token);
      if (!user?.id || user.id !== claims.sub) return send(res, 401, { error: 'Sessão inválida. Entre novamente.' }, origin);
      const result = await eraseAccountData(user);
      return send(res, 200, { ok: true, ...result }, origin);
    } catch (error) {
      return send(res, 503, { error: error.message || 'Não foi possível concluir a exclusão segura.' }, origin);
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/orders') {
    if (!databaseUrl || !pool || encryptionKey.length !== 32 || !supabaseUrl || !supabaseKey || !supabaseServiceKey) return send(res, 503, { error: 'API privada ainda não configurada.' }, origin);
    if (origin && !allowedOrigins.has(origin)) return send(res, 403, { error: 'Origem não autorizada.' });
    try {
      const body = await readJson(req);
      const orderId = String(body?.requestId || '');
      if (text(body?.website, 200) || body?.acceptPrivacy !== true) return send(res, 400, { error: 'Revise os dados e aceite a política de privacidade.' }, origin);
      if (!validUuid(orderId) || !Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 30) return send(res, 400, { error: 'Identificador ou itens do pedido inválidos.' }, origin);
      let userId = null;
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (token) {
        const user = await verifySupabaseUser(token);
        if (!user?.id) return send(res, 401, { error: 'Sessão inválida. Entre novamente e tente de novo.' }, origin);
        userId = user.id;
      }
      const customer = normalizedCustomer(body.customer);
      const requested = body.items.map(item => ({ slug: text(item?.id, 100), size: text(item?.size, 30), color: text(item?.color, 50), quantity: Math.max(1, Math.min(20, Math.floor(Number(item?.quantity) || 0))) }));
      if (requested.some(item => !/^[a-z0-9-]+$/i.test(item.slug) || !item.quantity)) return send(res, 400, { error: 'Um produto da sacola está inválido.' }, origin);
      const slugs = [...new Set(requested.map(item => item.slug))];
      const catalogUrl = new URL(`${supabaseUrl}/rest/v1/products`);
      catalogUrl.searchParams.set('select', 'slug,name,price,active,sizes,colors');
      catalogUrl.searchParams.set('slug', `in.(${slugs.join(',')})`);
      catalogUrl.searchParams.set('active', 'eq.true');
      const catalogResponse = await fetch(catalogUrl, { headers: { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}` } });
      if (!catalogResponse.ok) return send(res, 503, { error: 'Não foi possível conferir os produtos agora.' }, origin);
      const catalog = await catalogResponse.json();
      const bySlug = new Map(catalog.map(item => [item.slug, item]));
      if (slugs.some(slug => !bySlug.has(slug))) return send(res, 400, { error: 'Um produto não está mais disponível. Atualize a sacola.' }, origin);
      const items = requested.map(request => {
        const product = bySlug.get(request.slug);
        if (request.size && Array.isArray(product.sizes) && product.sizes.length && !product.sizes.includes(request.size)) throw Object.assign(new Error('Um tamanho escolhido não está disponível.'), { status: 400 });
        if (request.color && Array.isArray(product.colors) && product.colors.length && !product.colors.includes(request.color)) throw Object.assign(new Error('Uma cor escolhida não está disponível.'), { status: 400 });
        const unitPrice = Number(product.price);
        return { id: product.slug, name: text(product.name, 180), quantity: request.quantity, size: request.size, color: request.color, unitPrice, lineTotal: Math.round(unitPrice * request.quantity * 100) / 100 };
      });
      const subtotal = Math.round(items.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100;
      const status = 'Aguardando confirmação de frete e pagamento';
      const { encrypted, iv, tag } = encryptJson(customer);
      await pool.query(`
        insert into private.customer_sensitive_orders (order_id, user_id, payload_ciphertext, payload_iv, payload_auth_tag, encryption_version, updated_at)
        values ($1::uuid, $2::uuid, $3, $4, $5, 1, now())
        on conflict (order_id) do update set user_id = excluded.user_id, payload_ciphertext = excluded.payload_ciphertext, payload_iv = excluded.payload_iv, payload_auth_tag = excluded.payload_auth_tag, encryption_version = 1, updated_at = now()
      `, [orderId, userId, encrypted, iv, tag]);
      const summary = { order_id: orderId, request_id: orderId, user_id: userId, items, subtotal, status };
      const saved = await fetch(`${supabaseUrl}/rest/v1/order_summaries`, { method: 'POST', headers: { apikey: supabaseServiceKey, authorization: `Bearer ${supabaseServiceKey}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(summary) });
      if (!saved.ok) return send(res, 503, { error: 'Dados protegidos foram salvos; não foi possível registrar o resumo do pedido.' }, origin);
      return send(res, 200, { ok: true, orderId, status }, origin);
    } catch (error) {
      return send(res, error.status || 503, { error: error.status ? error.message : 'Não foi possível registrar o pedido protegido.' }, origin);
    }
  }

  const privateOrder = url.pathname.match(/^\/api\/orders\/([0-9a-f-]+)\/private$/i);
  if (req.method === 'GET' && privateOrder) {
    if (!databaseUrl || !pool || encryptionKey.length !== 32 || !supabaseUrl || !supabaseKey) return send(res, 503, { error: 'Consulta privada ainda não configurada.' }, origin);
    if (origin && !allowedOrigins.has(origin)) return send(res, 403, { error: 'Origem não autorizada.' });
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return send(res, 401, { error: 'Entre na sua conta.' }, origin);
    try {
      const user = await verifySupabaseUser(token);
      if (!user?.id) return send(res, 401, { error: 'Sessão inválida.' }, origin);
      const orderId = privateOrder[1];
      if (!validUuid(orderId)) return send(res, 400, { error: 'Número de pedido inválido.' }, origin);
      const admin = await isAdmin(user, token);
      const result = await pool.query(`
        select user_id, payload_ciphertext, payload_iv, payload_auth_tag
        from private.customer_sensitive_orders
        where order_id = $1::uuid and (user_id = $2::uuid or $3::boolean)
        limit 1
      `, [orderId, user.id, admin]);
      if (!result.rowCount) return send(res, 404, { error: 'Pedido não encontrado.' }, origin);
      const row = result.rows[0];
      const customer = decryptJson(row.payload_ciphertext, row.payload_iv, row.payload_auth_tag);
      return send(res, 200, { orderId, customer }, origin);
    } catch {
      return send(res, 503, { error: 'Não foi possível consultar os dados protegidos.' }, origin);
    }
  }
  return send(res, 404, { error: 'Não encontrado.' });
}

const server = createServer((req, res) => { void handle(req, res); });
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.listen(port, '0.0.0.0', () => console.log(`API privada ativa na porta ${port}.`));

async function shutdown() {
  server.close(async () => { if (pool) await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);



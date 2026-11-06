// Checkout is posted directly to Render. This legacy endpoint intentionally
// rejects submissions so personal data cannot be stored/transited here.
Deno.serve((req) => {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405, headers });
  return new Response(JSON.stringify({ error: 'Endpoint desativado. Atualize o site para usar a API privada da loja.' }), { status: 410, headers });
});

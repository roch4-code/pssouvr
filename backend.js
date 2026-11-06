(() => {
  const cfg = window.DEJ_BACKEND_CONFIG || {};
  const supabaseUrl = (cfg.supabaseUrl || '').replace(/\/$/, '');
  const publishableKey = cfg.supabasePublishableKey || '';
  const privateApiUrl = (cfg.privateApiUrl || '').replace(/\/$/, '');
  const adminEmail = (cfg.adminEmail || '').trim().toLowerCase();
  const configured = Boolean(supabaseUrl && publishableKey);
  let clientPromise;
  let currentUser = null;

  const callbackUrl = (target = '/minha-conta') => {
    const hash = `#${target}`;
    if (location.protocol === 'file:') return `${location.href.split('#')[0]}${hash}`;
    return `${location.origin}${location.pathname}${hash}`;
  };
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };
  const normalizePhone = value => { let digits=String(value||'').replace(/\D/g,''); if(digits.startsWith('00'))digits=digits.slice(2); if(digits.startsWith('55'))return '+'+digits; if(digits.length===10||digits.length===11)return '+55'+digits; throw new Error('Informe um celular brasileiro com DDD.'); };
  async function getClient() {
    if (!configured) throw new Error('Configure a autenticação do Supabase neste site.');
    if (!clientPromise) clientPromise = import('https://esm.sh/@supabase/supabase-js@2?bundle&target=es2022').then(({ createClient }) => {
      if (!createClient) throw new Error('Não foi possível carregar o cliente do Supabase.');
      return createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { headers: { 'X-Client-Info': 'dej-store-web' } }
      });
    });
    return clientPromise;
  }
  const toStoreProduct = p => ({
    id: p.slug, name: p.name, category: p.category, stamp: p.stamp || '',
    price: Number(p.price), oldPrice: p.old_price == null ? undefined : Number(p.old_price),
    sizes: p.sizes || [], colors: p.colors || [], tag: p.tag || '', description: p.description || '',
    sourceUrl: p.source_url || '', image: p.image || '',
    images: Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []),
    active: p.active !== false, sortOrder: Number(p.sort_order || 0)
  });
  async function requireAdmin() {
    const client = await getClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) throw new Error('Entre com a conta administradora.');
    if ((user.email || '').trim().toLowerCase() !== adminEmail) throw new Error('Esta conta não tem permissão de administração.');
    const { data: member, error: membershipError } = await client.from('store_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    if (membershipError || !member) throw new Error('Esta conta ainda não foi autorizada na tabela store_admins do Supabase.');
    currentUser = user;
    return { client, user };
  }

  window.DEJBackend = {
    configured, adminEmail, storeWhatsApp: cfg.storeWhatsApp || '5521982579301',
    getStoredUser() { return currentUser; },
    async restoreOAuthCallback() { return this.restoreSession(); },
    async restoreSession() {
      if (!configured) return null;
      const client = await getClient();
      const { data: { session }, error } = await client.auth.getSession();
      if (error) throw error;
      currentUser = session?.user || null;
      return currentUser;
    },
    async signInCustomer(identity, password) {
      const client = await getClient();
      const identifier=String(identity||'').trim();
      const credentials=identifier.includes('@')?{email:identifier,password}:{phone:normalizePhone(identifier),password};
      const { data, error } = await client.auth.signInWithPassword(credentials);
      if (error) throw error; currentUser = data.user || data.session?.user || null; return currentUser;
    },
    async signUpCustomer(email, password, name='', phone='') {
      const client = await getClient();
      const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl('/login'), data:{full_name:String(name||'').trim(),phone:normalizePhone(phone)} } });
      if (error) throw error; currentUser = data.session?.user || null; return { user: currentUser || data.user || null, signedIn: Boolean(currentUser) };
    },
    async signUpPhoneCustomer(phone, password, name, email) {
      const client=await getClient(), normalized=normalizePhone(phone);
      const {data,error}=await client.auth.signUp({phone:normalized,password,options:{data:{full_name:String(name||'').trim(),contact_email:String(email||'').trim().toLowerCase()}}});
      if(error)throw error; currentUser=data.session?.user||null; return {user:currentUser||data.user||null,signedIn:Boolean(currentUser)};
    },
    async verifyPhoneSignup(phone, token) {
      const client=await getClient(), normalized=normalizePhone(phone);
      const {data,error}=await client.auth.verifyOtp({phone:normalized,token:String(token||'').trim(),type:'sms'});
      if(error)throw error; currentUser=data.user||data.session?.user||null; if(!currentUser)throw new Error('O Supabase não retornou a conta confirmada.'); return currentUser;
    },
    async resendAdminVerification(email) {
      if ((email || '').trim().toLowerCase() !== adminEmail) throw new Error('O reenvio está disponível apenas para a conta administradora configurada.');
      const client = await getClient();
      const { error } = await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: callbackUrl('/login') } });
      if (error) throw error;
    },
    async resetPassword(email) {
      const client = await getClient();
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl('/login') });
      if (error) throw error;
    },
    async signOutCustomer() {
      const client = await getClient();
      const { error } = await client.auth.signOut();
      if (error) throw error;
      currentUser = null;
    },
    async reauthenticateAndDeleteAccount(identity, password) {
      const client = await getClient();
      const { data: { user: activeUser }, error: userError } = await client.auth.getUser();
      if (userError || !activeUser) throw new Error('Entre novamente para continuar.');
      const expected = activeUser.email || activeUser.phone || '';
      const normalize = value => activeUser.email ? String(value || '').trim().toLowerCase() : String(value || '').replace(/\D/g, '');
      if (!expected || normalize(identity) !== normalize(expected)) throw new Error('O e-mail ou celular informado não corresponde à conta conectada.');
      if (!password) throw new Error('Informe sua senha atual.');
      const credentials = activeUser.email ? { email: activeUser.email, password } : { phone: activeUser.phone, password };
      const { data, error } = await client.auth.signInWithPassword(credentials);
      if (error) throw new Error('Não foi possível confirmar sua senha. Confira os dados e tente novamente.');
      if (!data.user || data.user.id !== activeUser.id || !data.session?.access_token) throw new Error('A autenticação não corresponde à conta conectada.');
      if (!privateApiUrl) throw new Error('O serviço seguro de exclusão ainda não está configurado.');
      const response = await fetch(`${privateApiUrl}/api/account/delete`, { method: 'POST', headers: { authorization: `Bearer ${data.session.access_token}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(result?.error || 'Não foi possível excluir a conta e os dados associados.');
      for (const key of [`dej-cart-${activeUser.id}`, `dej-favs-${activeUser.id}`]) localStorage.removeItem(key);
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
      currentUser = null;
      return result;
    },
    toStoreProduct,
    async loadStamps() {
      if (!configured) return null;
      const client=await getClient();
      return unwrap(await client.from('store_stamps').select('slug,name,image,sort_order').eq('active',true).order('sort_order',{ascending:true}));
    },
    async loadHomeSections() {
      if (!configured) return null;
      const client = await getClient();
      return unwrap(await client.from('home_sections').select('section_key,title,description,product_slugs'));
    },
    async saveAdminHomeSection(section) {
      const { client } = await requireAdmin();
      const row = {
        section_key: String(section.section_key || ''),
        title: String(section.title || '').trim(),
        description: String(section.description || '').trim(),
        product_slugs: Array.isArray(section.product_slugs) ? [...new Set(section.product_slugs.map(String))] : []
      };
      if (!['women', 'featured', 'news'].includes(row.section_key)) throw new Error('Esta seção da página inicial não pode ser alterada.');
      if (!row.title || row.title.length > 80 || row.description.length > 240) throw new Error('Confira o nome e a descrição da seção.');
      if (row.product_slugs.length > 40) throw new Error('Selecione no máximo 40 produtos para esta seção.');
      return unwrap(await client.from('home_sections').upsert(row, { onConflict: 'section_key' }).select().single());
    },
    async saveAdminStamp(stamp, originalSlug='') {
      const {client}=await requireAdmin();
      const row={slug:String(stamp.slug||'').trim().toLowerCase(),name:String(stamp.name||'').trim(),image:String(stamp.image||'').trim(),sort_order:Number(stamp.sort_order||0),active:true};
      if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug)||!row.name||!row.image)throw new Error('Preencha o nome, identificador e foto da estampa.');
      if(originalSlug)return unwrap(await client.from('store_stamps').update(row).eq('slug',originalSlug).select().single());
      return unwrap(await client.from('store_stamps').insert(row).select().single());
    },
    async loadProducts() {
      if (!configured) return null;
      const client = await getClient();
      const rows = unwrap(await client.from('products').select('*').eq('active', true).order('sort_order', { ascending: true }));
      return Array.isArray(rows) && rows.length ? rows.map(toStoreProduct) : null;
    },
    async signIn(email, password) {
      if ((email || '').trim().toLowerCase() !== adminEmail) throw new Error('Esta conta não tem permissão de administração.');
      const user = await this.signInCustomer(email, password);
      if (!user) throw new Error('O Supabase não retornou os dados da conta.');
      if (user.email_confirmed_at == null && user.confirmed_at == null) throw new Error('Confirme o e-mail administrador antes de entrar no painel.');
      await requireAdmin();
      return { accessToken: 'supabase-session', user };
    },
    async uploadProductImage(_token, file, onProgress) {
      const { client } = await requireAdmin();
      if (!(file instanceof File) || !file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem válido.');
      if (file.size > 1024 * 1024 * 1024) throw new Error('Cada imagem deve ter até 1 GB.');
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'produto';
      const path = `${crypto.randomUUID()}-${safeName}`;
      if (onProgress) onProgress(10);
      const { error } = await client.storage.from('product-images').upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' });
      if (error) throw error;
      if (onProgress) onProgress(100);
      return client.storage.from('product-images').getPublicUrl(path).data.publicUrl;
    },
    async uploadAdminProductImage(file, onProgress) { return this.uploadProductImage(null, file, onProgress); },
    async saveAdminProduct(product, originalSlug) { const { client } = await requireAdmin(); return this.saveProduct(client, product, originalSlug); },
    async submitOrder(order) {
      if (!configured || !privateApiUrl) throw new Error('Configure a autenticação do Supabase e a API privada da loja.');
      if (!order?.acceptPrivacy) throw new Error('É necessário aceitar a política de privacidade.');
      if (order?.website) throw new Error('Não foi possível validar o pedido.');
      const client = await getClient();
      const { data: { session } } = await client.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`;
      const response = await fetch(`${privateApiUrl}/api/orders`, { method: 'POST', headers, body: JSON.stringify(order) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Não foi possível registrar o pedido.');
      return data;
    },
    async adminOrders() {
      if (!privateApiUrl) throw new Error('API privada não configurada para pedidos.');
      const { client } = await requireAdmin();
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão administrativa expirada. Entre novamente.');
      const response = await fetch(`${privateApiUrl}/api/admin/orders`, { headers: { authorization: `Bearer ${session.access_token}` }, cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(result?.error || 'Não foi possível carregar os pedidos.');
      return Array.isArray(result.orders) ? result.orders : [];
    },
    async deleteAdminOrders(orderIds) {
      if (!privateApiUrl) throw new Error('API privada não configurada para pedidos.');
      const { client } = await requireAdmin();
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão administrativa expirada. Entre novamente.');
      const response = await fetch(`${privateApiUrl}/api/admin/orders/delete`, { method: 'POST', headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ orderIds }), cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(result?.error || 'Não foi possível excluir os pedidos selecionados.');
      return result;
    },
    async updateAdminOrderStatus(orderId, status) {
      if (!privateApiUrl) throw new Error('API privada não configurada para pedidos.');
      const { client } = await requireAdmin();
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão administrativa expirada. Entre novamente.');
      const response = await fetch(`${privateApiUrl}/api/admin/orders/${encodeURIComponent(orderId)}/status`, { method: 'PATCH', headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status }), cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(result?.error || 'Não foi possível salvar a etapa do pedido.');
      return result;
    },    async adminProducts() {
      const { client } = await requireAdmin();
      return unwrap(await client.from('products').select('*').order('sort_order', { ascending: true }));
    },
    async saveProduct(_client, product, originalSlug = '') {
      const { client } = await requireAdmin();
      const row = {
        slug: String(product.slug || '').trim(), name: String(product.name || '').trim(), category: String(product.category || '').trim(), stamp: String(product.stamp || '').trim() || null,
        price: Number(product.price), old_price: product.old_price === '' ? null : Number(product.old_price),
        sizes: String(product.sizes || '').split(',').map(x => x.trim()).filter(Boolean), colors: String(product.colors || '').split(',').map(x => x.trim()).filter(Boolean),
        tag: String(product.tag || '').trim() || null, description: String(product.description || '').trim(), image: String(product.image || '').trim(),
        images: Array.isArray(product.images) ? [...new Set(product.images.map(x => String(x).trim()).filter(Boolean))] : (product.image ? [product.image] : []),
        source_url: String(product.source_url || '').trim(), active: product.active !== false, sort_order: Number(product.sort_order || 0)
      };
      if (!row.slug || !row.name || !Number.isFinite(row.price) || row.price < 0) throw new Error('Preencha identificador, nome e preço válido.');
      if (originalSlug) return unwrap(await client.from('products').update(row).eq('slug', originalSlug).select());
      return unwrap(await client.from('products').insert(row).select());
    }
  };
})();

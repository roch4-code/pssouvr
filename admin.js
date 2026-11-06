(() => {
  const $ = (s) => document.querySelector(s), cfg = window.DEJBackend;
  const loginPanel = $('#login-panel'), catalogPanel = $('#catalog-panel'), loginStatus = $('#login-status'), saveStatus = $('#save-status');
  let token = '', editingSlug = '', rows = [], orderRows = [];
  const selectedOrderIds = new Set();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if (!cfg.configured) $('#setup-warning').classList.remove('admin-hidden');
  function showCatalog() { loginPanel.classList.add('admin-hidden'); catalogPanel.classList.remove('admin-hidden'); loadRows(); }
  function productForm(row = null) {
    const f = $('#product-form'); if (!f) return;
    for (const field of Array.from(f.elements)) { if (field.type === 'checkbox') field.checked = false; else if (field.name && field.type !== 'file') field.value = ''; else if (field.type === 'file') field.value = ''; }
    editingSlug = row?.slug || '';
    $('#editor-title').textContent = row ? `Editar produto · ${row.name}` : 'Novo produto';
    $('#images-status').textContent = '';
    if (!row) { f.elements.active.checked = true; f.elements.sort_order.value = '0'; renderImagePreview(); return; }
    for (const name of ['slug','name','category','stamp','price','tag','description','image','source_url','sort_order']) f.elements[name].value = row[name] ?? '';
    f.elements.old_price.value = row.old_price ?? '';
    f.elements.sizes.value = (row.sizes || []).join(', ');
    f.elements.colors.value = (row.colors || []).join(', ');
    f.elements.images.value = (row.images || []).filter(url => url && url !== row.image).join('\n');
    f.elements.active.checked = !!row.active;
    renderImagePreview();
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function formImageUrls() {
    const primary = $('#product-form').elements.image.value.trim();
    const more = $('#product-form').elements.images.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    return [...new Set([primary, ...more].filter(Boolean))];
  }
  function renderImagePreview() {
    const urls = formImageUrls();
    $('#product-image-preview').innerHTML = urls.map((url,i)=>`<figure class="admin-image-preview"><img src="${esc(url)}" alt="Prévia ${i+1}" loading="lazy"><figcaption>${i===0?'Foto principal':`Foto ${i+1}`}</figcaption></figure>`).join('') || '<p class="admin-note">As prévias das fotos aparecerão aqui.</p>';
  }
  async function loadRows() {
    $('#admin-products').innerHTML = '<p class="admin-note">Carregando produtos…</p>';
    try {
      rows = await cfg.adminProducts(token);
      $('#admin-products').innerHTML = rows.map((p,i)=>`<button class="admin-row" data-edit="${i}" type="button"><span class="admin-row-thumb"><img src="${esc(p.image)}" alt="" loading="lazy"></span><span class="admin-row-copy"><strong>${esc(p.name)}</strong><small>${esc(p.slug)} · ${p.active?'Visível':'Oculto'} · ${(p.images||[]).length||1} foto(s) · ${Number(p.price).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</small></span><span class="admin-row-action">Editar →</span></button>`).join('') || '<p class="admin-note">Nenhum produto cadastrado.</p>';
      document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>productForm(rows[Number(b.dataset.edit)]));
    } catch (e) { $('#admin-products').innerHTML = `<p class="admin-status">${esc(e.message)}</p>`; }
  }
  const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const orderStages = ['Aguardando confirmação de frete e pagamento', 'Empacotado', 'Enviado', 'Recebeu'];
  const olderThan90Days = order => order.createdAt && Date.now() - new Date(order.createdAt).getTime() >= 90 * 24 * 60 * 60 * 1000;
  function updateSelectionControls() {
    const visibleIds = orderRows.map(order => order.orderId);
    const selectedVisible = visibleIds.filter(id => selectedOrderIds.has(id));
    $('#delete-selected-orders').disabled = selectedVisible.length === 0;
    $('#delete-selected-orders').textContent = `Excluir selecionados (${selectedVisible.length})`;
    $('#select-all-orders').checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
    $('#select-all-orders').indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
  }
  function maybeShowMonthlyCleanup() {
    const oldOrders = orderRows.filter(olderThan90Days);
    const today = new Date();
    const key = `dej-order-cleanup-reminder-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const banner = $('#monthly-cleanup');
    if (!oldOrders.length || localStorage.getItem(key)) { banner.hidden = true; return; }
    $('#monthly-cleanup-message').textContent = `Revisão mensal: há ${oldOrders.length} pedido(s) com mais de 90 dias. Se quiser liberar espaço, selecione os antigos abaixo e confirme a exclusão. Nada será apagado automaticamente.`;
    banner.hidden = false;
    localStorage.setItem(key, 'shown');
  }
  async function deleteOrders(orderIds) {
    if (!orderIds.length) return;
    const warning = orderIds.length === 1 ? 'Este pedido e os dados pessoais cifrados serão apagados permanentemente.' : `${orderIds.length} pedidos e seus dados pessoais cifrados serão apagados permanentemente.`;
    if (!window.confirm(`${warning}\n\nEssa ação não pode ser desfeita. Deseja continuar?`)) return;
    $('#orders-status').textContent = 'Excluindo pedidos e dados associados…';
    try {
      const result = await cfg.deleteAdminOrders(orderIds);
      orderIds.forEach(id => selectedOrderIds.delete(id));
      $('#orders-status').textContent = `${result.deleted} pedido(s) excluído(s) da planilha administrativa e dos bancos de dados.`;
      await loadOrders();
    } catch (error) { $('#orders-status').textContent = error.message || 'Não foi possível excluir os pedidos.'; }
  }
  function renderOrders() {
    const tbody = $('#admin-orders');
    if (!orderRows.length) { tbody.innerHTML = '<tr><td class="order-empty" colspan="10">Nenhum pedido encontrado.</td></tr>'; updateSelectionControls(); return; }
    tbody.innerHTML = orderRows.map(order => {
      const customer = order.customer || {};
      const date = order.createdAt ? new Date(order.createdAt).toLocaleString('pt-BR') : '—';
      const address = [customer.address, customer.addressExtra, customer.postalCode, customer.cityState].filter(Boolean).join(' · ') || 'Dados de entrega não disponíveis';
      const items = (order.items || []).map(item => `<p class="order-item"><strong>${esc(item.quantity)} × ${esc(item.name)}</strong><br><small>${esc(item.size || 'Sem tamanho')} · ${esc(item.color || 'Sem cor')} · ${money(item.lineTotal)}</small></p>`).join('') || '—';
      const stages = [...new Set([...orderStages, order.status].filter(Boolean))];
      const options = stages.map(stage => `<option value="${esc(stage)}" ${stage === order.status ? 'selected' : ''}>${esc(stage)}</option>`).join('');
      return `<tr><td><label><input class="order-row-check" type="checkbox" data-order-select="${esc(order.orderId)}" ${selectedOrderIds.has(order.orderId) ? 'checked' : ''} aria-label="Selecionar pedido ${esc(order.orderId)}"><span class="order-id">${esc(order.orderId)}</span></label><br><small>${esc(date)}</small></td><td>${esc(customer.name || '—')}<br><small>${esc(customer.email || '—')}</small></td><td>${esc(customer.phone || '—')}</td><td>${esc(customer.cpf || '—')}</td><td>${esc(address)}</td><td>${items}</td><td>${money(order.subtotal)}</td><td>Não informado</td><td>Não informado</td><td><select data-order-status="${esc(order.orderId)}" aria-label="Etapa do pedido ${esc(order.orderId)}">${options}</select><button class="order-delete-one" data-delete-order="${esc(order.orderId)}" type="button">Excluir pedido</button></td></tr>`;
    }).join('');
    document.querySelectorAll('[data-order-select]').forEach(input => input.addEventListener('change', () => { input.checked ? selectedOrderIds.add(input.dataset.orderSelect) : selectedOrderIds.delete(input.dataset.orderSelect); updateSelectionControls(); }));
    document.querySelectorAll('[data-delete-order]').forEach(button => button.addEventListener('click', () => deleteOrders([button.dataset.deleteOrder])));
    document.querySelectorAll('[data-order-status]').forEach(select => select.addEventListener('change', async () => {
      const order = orderRows.find(row => row.orderId === select.dataset.orderStatus), previous = order?.status || orderStages[0], next = select.value;
      select.disabled = true; $('#orders-status').textContent = 'Salvando etapa do pedido…';
      try {
        await cfg.updateAdminOrderStatus(order.orderId, next);
        order.status = next;
        $('#orders-status').textContent = 'Etapa do pedido atualizada.';
      } catch (error) { select.value = previous; $('#orders-status').textContent = error.message || 'Não foi possível atualizar o pedido.'; }
      finally { select.disabled = false; }
    }));
    updateSelectionControls();
  }
  async function loadOrders() {
    $('#admin-orders').innerHTML = '<tr><td class="order-empty" colspan="10">Carregando pedidos protegidos…</td></tr>';
    $('#orders-status').textContent = '';
    try { orderRows = await cfg.adminOrders(token); for (const id of selectedOrderIds) if (!orderRows.some(order => order.orderId === id)) selectedOrderIds.delete(id); renderOrders(); maybeShowMonthlyCleanup(); }
    catch (error) { orderRows = []; $('#monthly-cleanup').hidden = true; $('#admin-orders').innerHTML = `<tr><td class="order-empty" colspan="10">${esc(error.message || 'Não foi possível carregar os pedidos.')}</td></tr>`; updateSelectionControls(); }
  }
  let stampRows = [], editingStamp = null;
  async function loadAdminStamps() {
    $('#admin-stamps').innerHTML='<p class="admin-note">Carregando estampas…</p>';
    try {
      stampRows=await cfg.loadStamps()||[];
      $('#admin-stamps').innerHTML=stampRows.map((stamp,i)=>'<div class="admin-row"><span class="admin-row-thumb"><img src="'+esc(stamp.image)+'" alt=""></span><span class="admin-row-copy"><strong>'+esc(stamp.name)+'</strong><small>'+esc(stamp.slug)+'</small></span><button type="button" data-edit-stamp="'+i+'">Editar ✎</button></div>').join('')||'<p class="admin-note">Nenhuma estampa cadastrada.</p>';
      document.querySelectorAll('[data-edit-stamp]').forEach(button=>button.onclick=()=>fillStampForm(stampRows[Number(button.dataset.editStamp)]));
    } catch(error) { $('#admin-stamps').innerHTML='<p class="admin-status">'+esc(error.message||'Não foi possível carregar as estampas. Execute supabase-stamps-setup.sql no Supabase.')+'</p>'; }
  }
  function fillStampForm(stamp=null) {
    const form=$('#stamp-form'); editingStamp=stamp; form.reset(); form.elements.original_slug.value=stamp?.slug||'';
    form.elements.name.value=stamp?.name||''; form.elements.slug.value=stamp?.slug||''; form.elements.image.value=stamp?.image||'';
    form.elements.products.innerHTML=rows.map(product=>'<option value="'+esc(product.slug)+'" '+((stamp&&product.stamp===stamp.slug)?'selected':'')+'>'+esc(product.name)+'</option>').join('');
    $('#stamp-save-status').textContent=''; window.scrollTo({top:0,behavior:'smooth'});
  }
  $('#new-stamp-button').addEventListener('click',()=>fillStampForm());
  $('#clear-stamp-form').addEventListener('click',()=>fillStampForm());
  $('#stamp-form').addEventListener('submit',async event=>{
    event.preventDefault(); const form=event.currentTarget, data=new FormData(form), status=$('#stamp-save-status'), button=form.querySelector('[type=submit]'); button.disabled=true; status.textContent='Salvando estampa…';
    try {
      let image=String(data.get('image')||'').trim(); const file=form.elements.image_file.files[0];
      if(file){if(!file.type.startsWith('image/'))throw new Error('Selecione uma imagem válida.');if(file.size>1024*1024*1024)throw new Error('A imagem deve ter até 1 GB.');image=await cfg.uploadProductImage(token,file,p=>{status.textContent='Enviando imagem: '+p+'%';});}
      const stamp={slug:String(data.get('slug')||'').trim().toLowerCase(),name:String(data.get('name')||'').trim(),image,sort_order:editingStamp?.sort_order??stampRows.length};
      await cfg.saveAdminStamp(stamp,editingStamp?.slug||'');
      const selected=new Set([...form.elements.products.selectedOptions].map(option=>option.value));
      for(const product of rows){const was=editingStamp&&product.stamp===editingStamp.slug, now=selected.has(product.slug);if(!was&&!now)continue;const values={...product,slug:product.slug,stamp:now?stamp.slug:'other',sizes:(product.sizes||[]).join(', '),colors:(product.colors||[]).join(', '),old_price:product.old_price??'',images:Array.isArray(product.images)?product.images:[product.image].filter(Boolean)};await cfg.saveProduct(token,values,product.slug);product.stamp=values.stamp;}
      if(editingStamp)stampRows=stampRows.filter(item=>item.slug!==editingStamp.slug);stampRows.push(stamp);stampRows.sort((a,b)=>a.sort_order-b.sort_order);status.textContent='Estampa salva e produtos relacionados atualizados.';editingStamp=null;fillStampForm();await loadAdminStamps();await loadRows();
    }catch(error){status.textContent=error.message||'Não foi possível salvar a estampa.';}finally{button.disabled=false;}
  });
  function showAdminTab(tab) {
    const products=tab==='products', orders=tab==='orders', stamps=tab==='stamps';
    $('#catalog-view').classList.toggle('admin-hidden',!products); $('#orders-view').classList.toggle('admin-hidden',!orders); $('#stamps-view').classList.toggle('admin-hidden',!stamps);
    for(const [id,active] of [['tab-products',products],['tab-orders',orders],['tab-stamps',stamps]]){$('#'+id).classList.toggle('btn-outline',!active);$('#'+id).setAttribute('aria-selected',String(active));}
    if(orders)loadOrders(); if(stamps)loadAdminStamps();
  }
  function showOrdersTab(showOrders) { showAdminTab(showOrders?'orders':'products'); }
  $('#tab-products').addEventListener('click', () => showAdminTab('products'));
  $('#tab-orders').addEventListener('click', () => showAdminTab('orders'));
  $('#tab-stamps').addEventListener('click', () => showAdminTab('stamps'));
  $('#reload-orders').addEventListener('click', loadOrders);
  $('#select-all-orders').addEventListener('change', () => { for (const order of orderRows) $('#select-all-orders').checked ? selectedOrderIds.add(order.orderId) : selectedOrderIds.delete(order.orderId); renderOrders(); });
  $('#delete-selected-orders').addEventListener('click', () => deleteOrders(orderRows.map(order => order.orderId).filter(id => selectedOrderIds.has(id))));
  $('#select-old-orders').addEventListener('click', () => { orderRows.filter(olderThan90Days).forEach(order => selectedOrderIds.add(order.orderId)); renderOrders(); $('#monthly-cleanup').hidden = true; });
  $('#dismiss-monthly-cleanup').addEventListener('click', () => { $('#monthly-cleanup').hidden = true; });
  $('#resend-admin-verification').addEventListener('click', async () => {
    const email = $('#admin-login-form')?.elements?.email?.value || '';
    loginStatus.textContent = 'Enviando e-mail de verificação…';
    try { await cfg.resendAdminVerification(email); loginStatus.textContent = 'Se a conta estiver aguardando confirmação, um novo e-mail foi enviado. Confira a caixa de entrada e o spam.'; }
    catch (err) { loginStatus.textContent = err.message || 'Não foi possível reenviar o e-mail.'; }
  });
  $('#admin-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = form.elements.email.value;
    const password = form.elements.password.value;
    loginStatus.textContent = 'Validando acesso…';
    try {
      const result = await cfg.signIn(email, password);
      token = result.accessToken;
      form.elements.password.value = '';
      showCatalog();
    } catch (err) { loginStatus.textContent = err.message; }
  });
  $('#product-form').addEventListener('submit', async e => {
    e.preventDefault();
    saveStatus.textContent = 'Salvando…';
    const f = e.currentTarget, d = new FormData(f);
    const values = Object.fromEntries(['slug','name','category','stamp','price','old_price','sizes','colors','tag','description','image','source_url','sort_order'].map(k=>[k,d.get(k) ?? '']));
    values.images = formImageUrls();
    values.active = f.elements.active.checked;
    try {
      await cfg.saveProduct(token, values, editingSlug);
      saveStatus.textContent = 'Produto salvo no catálogo.';
      productForm();
      await loadRows();
    } catch (err) { saveStatus.textContent = err.message; }
  });
  $('#product-form').elements['image'].addEventListener('input', renderImagePreview);
  $('#product-form').elements['images'].addEventListener('input', renderImagePreview);
  $('#product-image-files').addEventListener('change', async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    const textarea = $('#product-form').elements.images;
    const status = $('#images-status');
    status.textContent = `Enviando ${files.length} foto(s)…`;
    try {
      const urls = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) throw new Error('Escolha apenas arquivos de imagem.');
        if (file.size > 1024 * 1024 * 1024) throw new Error('Cada imagem deve ter até 1 GB.');
        urls.push(await cfg.uploadProductImage(token, file, percent => { status.textContent = `Enviando ${file.name}: ${percent}%`; }));
      }
      const existing = textarea.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      textarea.value = [...new Set([...existing, ...urls])].join('\n');
      if (!$('#product-form').elements.image.value.trim() && urls.length) $('#product-form').elements.image.value = urls.shift();
      status.textContent = 'Fotos enviadas. Salve o produto para aplicar as alterações.';
      renderImagePreview();
    } catch (err) { status.textContent = err.message || 'Falha ao enviar as fotos.'; }
    finally { e.target.value = ''; }
  });
  $('#new-product-button').addEventListener('click',()=>{productForm();saveStatus.textContent='';});
  $('#logout-button').addEventListener('click',async()=>{await cfg.signOutCustomer();token='';rows=[];orderRows=[];selectedOrderIds.clear();document.querySelector('#admin-orders').replaceChildren();$('#monthly-cleanup').hidden=true;catalogPanel.classList.add('admin-hidden');loginPanel.classList.remove('admin-hidden');loginStatus.textContent='Você saiu do painel.';});
})();

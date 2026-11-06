(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const admin = () => Boolean(window.DEJBackend?.adminEmail && authUser?.email?.toLowerCase() === window.DEJBackend.adminEmail.toLowerCase());
  function formHtml(stamp = null) {
    const slug = stamp?.slug || '';
    const selected = products.filter(p => stamp && stampOfProduct(p) === stamp.slug).map(p => p.id);
    return `<form id="stamp-editor-form" class="stamp-admin-form"><input type="hidden" name="original_slug" value="${esc(slug)}"><label>Nome da estampa<input name="name" required value="${esc(stamp?.name || '')}" placeholder="Ex.: Nova estampa"></label><label>Identificador<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${esc(slug)}" placeholder="ex-nova-estampa"></label><label>Foto da estampa (URL)<input name="image" type="url" value="${esc(stamp?.image || '')}" placeholder="https://..."></label><label>Ou enviar foto<input name="image_file" type="file" accept="image/*"></label><label>Produtos desta estampa<select name="products" multiple size="9" aria-label="Produtos relacionados à estampa">${products.map(p => `<option value="${esc(p.id)}" ${selected.includes(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select><small>Selecione os produtos que devem aparecer quando o cliente abrir esta estampa. Use Ctrl para selecionar vários.</small></label><div class="stamp-admin-actions"><button class="btn" type="submit">Salvar estampa</button><button class="btn btn-outline" type="button" data-stamp-close>Cancelar</button></div><p class="stamp-admin-status" role="status" aria-live="polite"></p></form>`;
  }
  function managerHtml() {
    return `<div class="stamp-admin-head"><h3>Editar estampas</h3><button type="button" class="icon-btn" data-stamp-close aria-label="Fechar">×</button></div><div class="stamp-admin-list">${stampCatalog.map(st => `<div class="stamp-admin-row"><img src="${esc(st.image)}" alt=""><strong>${esc(st.name)}</strong><button type="button" class="btn btn-sm btn-outline" data-stamp-edit="${esc(st.slug)}">✎ Editar</button></div>`).join('')}</div><button type="button" class="btn" data-stamp-new>Adicionar estampa</button>`;
  }
  function showManager(modal, body) {
    body.innerHTML = managerHtml();
    modal.hidden = false;
    body.querySelectorAll('[data-stamp-close]').forEach(b => b.onclick = () => { modal.hidden = true; });
    body.querySelector('[data-stamp-new]')?.addEventListener('click', () => showEditor(modal, body));
  }
  function showEditor(modal, body, stamp = null) {
    body.innerHTML = `<div class="stamp-admin-head"><h3>${stamp ? 'Editar estampa' : 'Adicionar estampa'}</h3><button type="button" class="icon-btn" data-stamp-close aria-label="Fechar">×</button></div>${formHtml(stamp)}`;
    body.querySelectorAll('[data-stamp-close]').forEach(b => b.onclick = () => showManager(modal, body));
    const form = body.querySelector('#stamp-editor-form');
    form.onsubmit = async event => {
      event.preventDefault();
      const status = form.querySelector('.stamp-admin-status');
      const data = new FormData(form);
      status.textContent = 'Salvando estampa…';
      const button = form.querySelector('[type=submit]'); button.disabled = true;
      try {
        if (!admin()) throw new Error('Entre com a conta administradora para editar estampas.');
        let image = String(data.get('image') || '').trim();
        const file = form.elements.image_file.files[0];
        if (file) {
          if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.');
          if (file.size > 1024 * 1024 * 1024) throw new Error('A imagem deve ter até 1 GB.');
          image = await window.DEJBackend.uploadAdminProductImage(file, progress => { status.textContent = `Enviando foto: ${progress}%`; });
        }
        const slug = String(data.get('slug') || '').trim().toLowerCase();
        const row = { slug, name: String(data.get('name') || '').trim(), image, sort_order: stamp?.sort_order ?? stampCatalog.length };
        await window.DEJBackend.saveAdminStamp(row, stamp?.slug || '');
        const chosen = new Set([...form.elements.products.selectedOptions].map(option => option.value));
        for (const product of products) {
          const wasAssigned = stamp && (product.stamp === stamp.slug || stampOfProduct(product) === stamp.slug);
          const isAssigned = chosen.has(product.id);
          if (!wasAssigned && !isAssigned) continue;
          // Save an explicit value so legacy name-based fallback does not put a
          // deliberately unassigned product back into its previous stamp.
          const nextStamp = isAssigned ? slug : 'other';
          const values = { slug: product.id, name: product.name, category: product.category, stamp: nextStamp, price: String(product.price), old_price: product.oldPrice == null ? '' : String(product.oldPrice), sizes: (product.sizes || []).join(', '), colors: (product.colors || []).join(', '), tag: product.tag || '', description: product.description || '', image: product.image || '', images: product.images || [product.image].filter(Boolean), source_url: product.sourceUrl || '', active: product.active !== false, sort_order: String(product.sortOrder || 0) };
          await window.DEJBackend.saveAdminProduct(values, product.id);
          product.stamp = nextStamp;
        }
        stampCatalog = stampCatalog.filter(item => item.slug !== (stamp?.slug || slug));
        stampCatalog.push(row); stampCatalog.sort((a, b) => a.sort_order - b.sort_order);
        modal.hidden = true; render(); toast('Estampa e produtos relacionados foram atualizados.');
      } catch (error) { status.textContent = error.message || 'Não foi possível salvar a estampa.'; button.disabled = false; }
    };
  }
  window.bindStampAdmin = () => {
    const modal = document.getElementById('stamp-admin-modal');
    const body = document.getElementById('stamp-admin-body');
    if (!modal || !body || modal.dataset.bound) return;
    modal.dataset.bound = 'true';
    if(!window.__dejStampEditClickBound){window.__dejStampEditClickBound=true;document.addEventListener('click',event=>{const button=event.target.closest('[data-stamp-edit]');if(!button||button.closest('#stamp-admin-modal')||!admin())return;const target=document.getElementById('stamp-admin-modal'),targetBody=document.getElementById('stamp-admin-body');if(target&&targetBody)showEditor(target,targetBody,stampCatalog.find(item=>item.slug===button.dataset.stampEdit));});}
    modal.addEventListener('click', event => { if (event.target === modal) modal.hidden = true; });
    document.querySelector('[data-act="edit-stamps"]')?.addEventListener('click', () => { if (!admin()) return; showManager(modal, body); });
    modal.addEventListener('click', event => { const edit = event.target.closest('[data-stamp-edit]'); if (edit) showEditor(modal, body, stampCatalog.find(x => x.slug === edit.dataset.stampEdit)); });
  };
  window.bindAuthMethodSwitch = () => {
    document.querySelectorAll('[data-auth-method-choice]').forEach(button => {
      if (button.dataset.bound) return;
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        const method = button.dataset.authMethodChoice;
        const form = button.closest('.auth-wrap')?.querySelector('.auth-form');
        if (!form) return;
        form.elements.auth_method.value = method;
        button.closest('.auth-wrap').querySelectorAll('[data-auth-method-choice]').forEach(item => item.classList.toggle('is-active', item === button));
        const identity = form.querySelector('#login-identity');
        if (identity) {
          identity.type = method === 'phone' ? 'tel' : 'email';
          identity.inputMode = method === 'phone' ? 'tel' : 'email';
          identity.autocomplete = method === 'phone' ? 'tel' : 'username';
          identity.placeholder = method === 'phone' ? '(21) 99999-9999' : 'voce@exemplo.com';
          form.querySelector('#login-identity-label').textContent = method === 'phone' ? 'Celular' : 'E-mail';
        }
        const forgot = form.querySelector('[data-act="forgot"]'); if (forgot) forgot.hidden = method === 'phone';
      });
    });
  };
})();

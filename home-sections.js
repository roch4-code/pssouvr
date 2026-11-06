(() => {
  const sectionSettings = {};
  const allowedSections = new Set(['women', 'featured', 'news']);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const isAdmin = (user, adminEmail) => Boolean(user?.email && adminEmail && user.email.trim().toLowerCase() === adminEmail.trim().toLowerCase());

  function section({ key, eyebrow, title, description = '', productIds, products, card, moreLink = '', sectionClass = '', carousel = false, user, adminEmail }) {
    const setting = sectionSettings[key] || {};
    const titleText = setting.title || title;
    const descriptionText = Object.hasOwn(setting, 'description') ? setting.description : description;
    const ids = Array.isArray(setting.product_slugs) ? setting.product_slugs : productIds;
    const selected = ids.map(id => products.find(product => product.id === id)).filter(Boolean);
    const editButton = isAdmin(user, adminEmail)
      ? `<button class="home-section-pencil" type="button" data-edit-home-section="${key}" aria-label="Editar seção ${escapeHtml(titleText)}" title="Editar seção">✎</button>` : '';
    const productMarkup = selected.map(card).join('');
    const productContainer = carousel
      ? `<div class="carousel-wrap news-carousel-wrap"><button class="carousel-arrow" type="button" data-carousel="prev" data-scroll-target="${key}-products-carousel" aria-label="Produtos anteriores">‹</button><div class="product-carousel" id="${key}-products-carousel">${productMarkup}</div><button class="carousel-arrow" type="button" data-carousel="next" data-scroll-target="${key}-products-carousel" aria-label="Próximos produtos">›</button></div>`
      : `<div class="grid">${productMarkup}</div>`;
    return `<section class="section reveal ${sectionClass}" data-home-section="${key}"><div class="section-head"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(titleText)} ${editButton}</h2>${descriptionText ? `<p class="muted">${escapeHtml(descriptionText)}</p>` : ''}</div>${moreLink}</div>${productContainer}</section>`;
  }

  function modalMarkup(user, adminEmail) {
    if (!isAdmin(user, adminEmail)) return '';
    return `<div class="home-section-modal" id="home-section-editor" hidden><div class="home-section-dialog" role="dialog" aria-modal="true" aria-labelledby="home-section-editor-title"><div class="home-section-editor-head"><h3 id="home-section-editor-title">Editar seção</h3><button type="button" class="home-section-close" data-close-home-section aria-label="Fechar">×</button></div><form id="home-section-editor-form"><label>Nome da seção<input name="title" maxlength="80" required></label><label>Descrição<textarea name="description" rows="3" maxlength="240"></textarea></label><div class="home-section-products"><strong>Produtos e ordem de exibição</strong><p class="muted">Use as setas para definir a ordem. A primeira peça aparece primeiro.</p><ol id="home-section-selected-products"></ol></div><label>Adicionar produto<select name="add-product"><option value="">Escolha um produto</option></select></label><p class="home-section-editor-status" role="status" aria-live="polite"></p><div class="home-section-editor-actions"><button type="submit" class="btn">Salvar seção</button><button type="button" class="btn btn-outline" data-close-home-section>Cancelar</button></div></form></div></div>`;
  }

  function set(rows) {
    for (const row of rows || []) {
      if (!allowedSections.has(row.section_key)) continue;
      sectionSettings[row.section_key] = {
        title: String(row.title || ''),
        description: String(row.description || ''),
        product_slugs: Array.isArray(row.product_slugs) ? row.product_slugs.map(String) : []
      };
    }
  }

  function bind({ products, user, adminEmail, backend, rerender }) {
    if (!isAdmin(user, adminEmail)) return;
    const modal = document.getElementById('home-section-editor');
    const form = document.getElementById('home-section-editor-form');
    const list = document.getElementById('home-section-selected-products');
    const addSelect = form?.elements.namedItem('add-product');
    if (!modal || !form || !list || !addSelect) return;

    let activeKey = '';
    let chosenIds = [];
    const defaults = {
      women: ['cropped-so-deus-pode-me-julgar-preto', 'cropped-deus-e-o-juiz-preto', 'cropped-deus-e-o-juiz-branco', 'cropped-so-deus-pode-me-julgar-branco'],
      featured: ['camisa-oversize-anti-sistem-branca', 'bala-clava-anti-sistem', 'camisa-deus-e-o-juiz-preta', 'cropped-deus-e-o-juiz-branco'],
      news: products.filter(product => product.tag === 'Novo').map(product => product.id)
    };

    const drawSelected = () => {
      list.replaceChildren();
      chosenIds.forEach((id, index) => {
        const product = products.find(item => item.id === id);
        if (!product) return;
        const row = document.createElement('li');
        row.className = 'home-section-product-row';
        const image = document.createElement('img'); image.src = product.image; image.alt = ''; image.loading = 'lazy';
        const name = document.createElement('span'); name.textContent = product.name;
        const controls = document.createElement('span'); controls.className = 'home-section-product-controls';
        for (const [label, delta] of [['↑', -1], ['↓', 1]]) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
          button.setAttribute('aria-label', `${label === '↑' ? 'Mover para cima' : 'Mover para baixo'}: ${product.name}`);
          button.disabled = index + delta < 0 || index + delta >= chosenIds.length;
          button.addEventListener('click', () => { const target = index + delta; [chosenIds[index], chosenIds[target]] = [chosenIds[target], chosenIds[index]]; drawSelected(); });
          controls.append(button);
        }
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remover'; remove.addEventListener('click', () => { chosenIds = chosenIds.filter(item => item !== id); drawSelected(); drawAvailable(); });
        controls.append(remove); row.append(image, name, controls); list.append(row);
      });
    };

    const drawAvailable = () => {
      const previous = addSelect.value;
      addSelect.replaceChildren(new Option('Escolha um produto', ''));
      products.filter(product => !chosenIds.includes(product.id)).forEach(product => addSelect.add(new Option(product.name, product.id)));
      if ([...addSelect.options].some(option => option.value === previous)) addSelect.value = previous;
    };

    document.querySelectorAll('[data-edit-home-section]').forEach(button => button.addEventListener('click', () => {
      activeKey = button.dataset.editHomeSection;
      if (!allowedSections.has(activeKey)) return;
      const setting = sectionSettings[activeKey] || {};
      const section = button.closest('[data-home-section]');
      const defaultsForSection = defaults[activeKey] || [];
      form.elements.namedItem('title').value = setting.title || section?.querySelector('h2')?.childNodes[0]?.textContent?.trim() || '';
      form.elements.namedItem('description').value = Object.hasOwn(setting, 'description') ? setting.description : section?.querySelector('.section-head p')?.textContent || '';
      chosenIds = (Array.isArray(setting.product_slugs) ? setting.product_slugs : defaultsForSection).filter(id => products.some(product => product.id === id));
      drawSelected(); drawAvailable(); modal.hidden = false; form.elements.namedItem('title').focus();
    }));

    addSelect.addEventListener('change', () => {
      if (addSelect.value && !chosenIds.includes(addSelect.value)) chosenIds.push(addSelect.value);
      drawSelected(); drawAvailable();
    });
    document.querySelectorAll('[data-close-home-section]').forEach(button => button.addEventListener('click', () => { modal.hidden = true; }));
    modal.addEventListener('click', event => { if (event.target === modal) modal.hidden = true; });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const status = form.querySelector('.home-section-editor-status');
      const submit = form.querySelector('[type="submit"]');
      const payload = { section_key: activeKey, title: form.elements.namedItem('title').value.trim(), description: form.elements.namedItem('description').value.trim(), product_slugs: chosenIds };
      if (!payload.title) { status.textContent = 'Informe o nome da seção.'; return; }
      submit.disabled = true; status.textContent = 'Salvando alterações…';
      try {
        await backend.saveAdminHomeSection(payload);
        sectionSettings[activeKey] = { title: payload.title, description: payload.description, product_slugs: [...payload.product_slugs] };
        modal.hidden = true; rerender();
      } catch (error) {
        status.textContent = /home_sections|relation.*does not exist/i.test(error.message || '')
          ? 'Falta criar a tabela no Supabase. Execute supabase-home-sections-setup.sql no SQL Editor e tente novamente.'
          : error.message || 'Não foi possível salvar as alterações da seção.';
      } finally { submit.disabled = false; }
    });
  }

  window.DEJHomeSections = { section, modalMarkup, set, bind };
})();

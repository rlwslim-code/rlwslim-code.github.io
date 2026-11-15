/* GRIM Chapter I launch storefront enhancement.
 * Customer-facing catalogue read only. No payment, shipping, inventory or admin mutations.
 */
(() => {
  'use strict';
  const root = document.getElementById('grimLaunchFeatured');
  if (!root) return;

  const fallbackImg = '/assets/grim-wordmark.png';
  const money = amount => {
    if (typeof window.grimDisplayFromNGN === 'function') return window.grimDisplayFromNGN(amount);
    return new Intl.NumberFormat('en-NG', {style: 'currency', currency: 'NGN', maximumFractionDigits: 0}).format(amount);
  };
  const imageFor = product => {
    const image = typeof product.image === 'string' ? product.image.trim() : '';
    if (image.startsWith('/') && !image.startsWith('//')) return image;
    if (/^https:\/\//i.test(image)) return image;
    const id = Number(product.id);
    if (Number.isInteger(id) && id >= 1 && id <= 26) return `/assets/designs/design-${String(id).padStart(2, '0')}.jpeg`;
    return fallbackImg;
  };
  function makeCard(product, index) {
    const card = document.createElement('a');
    card.className = 'grim-launch-product';
    card.href = `/shop.html?search=${encodeURIComponent(String(product.name || '').slice(0, 80))}`;
    const media = document.createElement('div');
    media.className = 'grim-launch-product-image';
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = imageFor(product);
    image.alt = `${product.name || 'GRIM'} ${product.type || 'piece'} design`;
    image.onerror = () => { image.onerror = null; image.src = fallbackImg; };
    media.append(image);
    const content = document.createElement('div');
    content.className = 'grim-launch-product-copy';
    const eyebrow = document.createElement('small');
    eyebrow.textContent = `CHAPTER I / ${String(index + 1).padStart(2, '0')}`;
    const label = document.createElement('h3');
    label.textContent = String(product.name || 'GRIM').slice(0, 80);
    const detail = document.createElement('p');
    detail.textContent = `${product.type || 'GRIM piece'} · ${product.color || 'Signature colourway'}`;
    const foot = document.createElement('div');
    foot.className = 'grim-launch-product-foot';
    const price = document.createElement('strong');
    price.textContent = money(Number(product.price));
    const view = document.createElement('span');
    view.textContent = 'VIEW PIECE ↗';
    foot.append(price, view);
    content.append(eyebrow, label, detail, foot);
    card.append(media, content);
    return card;
  }
  function choose(products) {
    const active = products.filter(p => p && p.id != null && p.name && Number.isFinite(Number(p.price)) && Number(p.price) > 0 && Number(p.active ?? 1) === 1);
    const chosen = [], seenTypes = new Set();
    for (const p of active) {
      if (chosen.length >= 3) break;
      if (!seenTypes.has(String(p.type || ''))) { chosen.push(p); seenTypes.add(String(p.type || '')); }
    }
    for (const p of active) {
      if (chosen.length >= 3) break;
      if (!chosen.some(item => String(item.id) === String(p.id))) chosen.push(p);
    }
    return chosen;
  }
  function unavailable() {
    const wrap = document.createElement('div');
    wrap.className = 'grim-launch-catalog-unavailable';
    const message = document.createElement('p');
    message.textContent = 'Explore the full GRIM collection. Current product details are available on the shop page.';
    const link = document.createElement('a');
    link.href = '/shop.html';
    link.textContent = 'OPEN THE SHOP ↗';
    wrap.append(message, link);
    root.replaceChildren(wrap);
  }
  async function load() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      let response;
      try { response = await fetch('/api/products', {cache: 'no-store', credentials: 'same-origin', signal: controller.signal}); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw Error('catalogue unavailable');
      const payload = await response.json();
      if (!Array.isArray(payload)) throw Error('catalogue response invalid');
      const products = choose(payload);
      if (!products.length) return unavailable();
      root.replaceChildren(...products.map(makeCard));
    } catch (_) { unavailable(); }
  }
  load();
})();

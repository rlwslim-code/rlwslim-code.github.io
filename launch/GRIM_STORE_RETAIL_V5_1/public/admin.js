const SUPABASE_URL = 'https://ulogfaggaetywdqohunm.supabase.co';

// Paste your sb_publishable_... key between the quotes:
const SUPABASE_KEY = 'sb_publishable_r1L_7aIgsg-W4nb7YzJoeA_HwaYI2bK';

let supabase;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function esc(x = '') {
  return String(x).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

async function start() {
  const { createClient } = await import(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
  );

  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  setupLoginForm();
  setupTabs();
  setupAddForm();

  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    const admin = await isAdmin();

    if (admin) {
      showDashboard();
      await refreshStudio();
      return;
    }

    await supabase.auth.signOut();
  }

  showLogin();
}

function setupLoginForm() {
  const form = $('#loginForm');
  const password = $('#password');

  if (!$('#email')) {
    const email = document.createElement('input');
    email.id = 'email';
    email.type = 'email';
    email.required = true;
    email.placeholder = 'Admin email';

    form.insertBefore(email, password);
  }

  password.placeholder = 'Admin password';

  form.onsubmit = async e => {
    e.preventDefault();

    $('#loginMsg').textContent = 'SIGNING IN…';

    const email = $('#email').value.trim();
    const passwordValue = $('#password').value;

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: passwordValue
    });

    if (error) {
      $('#loginMsg').textContent = error.message;
      return;
    }

    if (!(await isAdmin())) {
      await supabase.auth.signOut();
      $('#loginMsg').textContent = 'THIS ACCOUNT IS NOT A GRIM ADMIN.';
      return;
    }

    $('#loginMsg').textContent = '';
    showDashboard();
    await refreshStudio();
  };

  $('#logout').onclick = async () => {
    await supabase.auth.signOut();
    location.reload();
  };
}

async function isAdmin() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return false;

  const { data, error } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  return !error && !!data;
}

function showLogin() {
  $('#login').hidden = false;
  $('#dash').hidden = true;
}

function showDashboard() {
  $('#login').hidden = true;
  $('#dash').hidden = false;
}

async function refreshStudio() {
  await Promise.all([
    loadProducts(),
    loadOrders()
  ]);
}

function setupTabs() {
  $$('.tabs button').forEach(button => {
    button.onclick = () => {
      $$('.tabs button').forEach(x => x.classList.remove('active'));
      button.classList.add('active');

      $('#productsTab').hidden = button.dataset.tab !== 'products';
      $('#ordersTab').hidden = button.dataset.tab !== 'orders';
    };
  });
}

function setupAddForm() {
  $('#addForm').onsubmit = async e => {
    e.preventDefault();

    const form = e.currentTarget;
    $('#addMsg').textContent = 'ADDING…';

    try {
      const file = form.image.files[0];

      let image =
        '/assets/grim-wordmark.png';

      if (file) {
        image = await uploadImage(file);
      }

      const product = {
        name: form.name.value.trim(),
        type: form.type.value,
        color: form.color.value.trim(),
        price: Number(form.price.value),
        sort_order: Number(form.sort_order.value || 100),
        image,
        active: 1
      };

      const { error } = await supabase
        .from('products')
        .insert(product);

      if (error) throw error;

      form.reset();
      form.sort_order.value = 100;

      $('#addMsg').textContent = 'PRODUCT ADDED ✓';

      await loadProducts();

    } catch (error) {
      $('#addMsg').textContent = error.message;
    }
  };
}

async function uploadImage(file) {
  const extension =
    file.name.split('.').pop().toLowerCase();

  const filename =
    `${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from('product-images')
    .upload(filename, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from('product-images')
    .getPublicUrl(filename);

  return data.publicUrl;
}

async function loadProducts() {
  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    $('#productList').innerHTML =
      `<p>${esc(error.message)}</p>`;
    return;
  }

  const live =
    products.filter(p => Number(p.active) === 1);

  $('#productCount').textContent =
    `${live.length} LIVE`;

  $('#productList').innerHTML =
    products.map(p => `
      <article class="card ${Number(p.active) === 1 ? '' : 'muted'}">

        <img src="${esc(p.image)}" alt="${esc(p.name)}">

        <form class="edit" data-id="${p.id}">

          <input
            name="name"
            value="${esc(p.name)}"
            required
          >

          <select name="type">
            ${[
              'Hoodie',
              'Tee',
              'Armless',
              'Complete GRIM Outfit',
              'Sweat Jacket'
            ].map(type =>
              `<option ${type === p.type ? 'selected' : ''}>${type}</option>`
            ).join('')}
          </select>

          <input
            name="color"
            value="${esc(p.color)}"
            required
          >

          <input
            name="price"
            type="number"
            value="${p.price}"
            required
          >

          <input
            name="sort_order"
            type="number"
            value="${p.sort_order || 0}"
          >

          <select name="active">
            <option
              value="1"
              ${Number(p.active) === 1 ? 'selected' : ''}
            >
              Live
            </option>

            <option
              value="0"
              ${Number(p.active) === 0 ? 'selected' : ''}
            >
              Hidden
            </option>
          </select>

          <label class="file full">
            REPLACE IMAGE
            <input
              name="image"
              type="file"
              accept="image/*"
            >
          </label>

          <div class="row full">
            <button>SAVE</button>

            <button
              type="button"
              class="danger hide-product"
            >
              HIDE
            </button>
          </div>

        </form>

      </article>
    `).join('');

  $$('.edit').forEach(form => {
    form.onsubmit = saveProduct;

    form.querySelector('.hide-product').onclick =
      () => hideProduct(form.dataset.id);
  });
}

async function saveProduct(e) {
  e.preventDefault();

  const form = e.currentTarget;
  const button = form.querySelector('button');

  button.textContent = 'SAVING…';

  try {
    const update = {
      name: form.name.value.trim(),
      type: form.type.value,
      color: form.color.value.trim(),
      price: Number(form.price.value),
      sort_order: Number(form.sort_order.value || 0),
      active: Number(form.active.value),
      updated_at: new Date().toISOString()
    };

    const file = form.image.files[0];

    if (file) {
      update.image = await uploadImage(file);
    }

    const { error } = await supabase
      .from('products')
      .update(update)
      .eq('id', form.dataset.id);

    if (error) throw error;

    button.textContent = 'SAVED ✓';

    setTimeout(() => {
      button.textContent = 'SAVE';
    }, 1000);

    await loadProducts();

  } catch (error) {
    alert(error.message);
    button.textContent = 'SAVE';
  }
}

async function hideProduct(id) {
  if (!confirm('Hide this product from the GRIM store?')) {
    return;
  }

  const { error } = await supabase
    .from('products')
    .update({
      active: 0,
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) {
    alert(error.message);
    return;
  }

  await loadProducts();
}

async function loadOrders() {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    $('#orders').innerHTML =
      `<p>${esc(error.message)}</p>`;
    return;
  }

  $('#orders').innerHTML =
    orders.map(o => `
      <div class="order">

        <strong>
          #${o.id} · ₦${Number(o.total || 0).toLocaleString()}
        </strong>

        <small>
          ${esc(o.name)} ·
          ${esc(o.email)} ·
          ${esc(o.phone || '')}
        </small>

        <small>
          ${esc(o.address || '')}
        </small>

        <small>
          ${esc(o.created_at)} ·
          ${esc(o.status || 'new')}
        </small>

      </div>
    `).join('') || '<p>No orders yet.</p>';
}

start().catch(error => {
  console.error(error);

  const msg = $('#loginMsg');

  if (msg) {
    msg.textContent =
      'OWNER STUDIO COULD NOT START: ' + error.message;
  }
});

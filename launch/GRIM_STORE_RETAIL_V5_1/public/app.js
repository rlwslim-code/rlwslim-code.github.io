const MARKETS={NG:{name:'Nigeria',currency:'NGN',locale:'en-NG',rate:1},US:{name:'United States',currency:'USD',locale:'en-US',rate:0.00067},GB:{name:'United Kingdom',currency:'GBP',locale:'en-GB',rate:0.00050},CA:{name:'Canada',currency:'CAD',locale:'en-CA',rate:0.00091},AU:{name:'Australia',currency:'AUD',locale:'en-AU',rate:0.00102},DE:{name:'Germany',currency:'EUR',locale:'de-DE',rate:0.00057},FR:{name:'France',currency:'EUR',locale:'fr-FR',rate:0.00057},IT:{name:'Italy',currency:'EUR',locale:'it-IT',rate:0.00057},ES:{name:'Spain',currency:'EUR',locale:'es-ES',rate:0.00057},NL:{name:'Netherlands',currency:'EUR',locale:'nl-NL',rate:0.00057},GH:{name:'Ghana',currency:'GHS',locale:'en-GH',rate:0.0073},ZA:{name:'South Africa',currency:'ZAR',locale:'en-ZA',rate:0.0114},KE:{name:'Kenya',currency:'KES',locale:'en-KE',rate:0.086},AE:{name:'United Arab Emirates',currency:'AED',locale:'en-AE',rate:0.00246},JP:{name:'Japan',currency:'JPY',locale:'ja-JP',rate:0.100}};
const CURRENCY_RATES={NGN:1,USD:.00067,GBP:.00050,EUR:.00057,CAD:.00091,AUD:.00102,GHS:.0073,ZAR:.0114,KES:.086,AED:.00246,JPY:.100};
let market=JSON.parse(localStorage.getItem('grimMarket')||'null')||{country:'NG',currency:'NGN'}; market.currency='NGN';
function money(n){return new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0}).format(Number(n)||0)}
function openMarket(){fillMarket();E('marketModal')?.classList.add('open')}function closeMarket(){E('marketModal')?.classList.remove('open')}
function fillMarket(){let c=E('marketCountry'),u=E('marketCurrency');if(!c||!u)return;c.innerHTML=Object.entries(MARKETS).map(([k,v])=>`<option value="${k}">${v.name}</option>`).join('');u.innerHTML='<option value="NGN">NGN — Nigerian Naira</option>';c.value=market.country||'NG';u.value='NGN';u.disabled=true}
function saveMarket(){market={country:E('marketCountry').value,currency:'NGN'};localStorage.setItem('grimMarket',JSON.stringify(market));updateMarketUI();render();draw();closeMarket()}
function updateMarketUI(){let x=MARKETS[market.country]||MARKETS.NG;market.currency='NGN';if(E('marketLabel'))E('marketLabel').textContent=`${x.name} · NGN`}
async function detectMarket(){try{let saved=JSON.parse(localStorage.getItem('grimMarket')||'null');if(saved?.country&&MARKETS[saved.country])market={country:saved.country,currency:'NGN'};else{let r=await fetch('/api/market',{cache:'no-store'}),j=await r.json();market={country:j.country&&MARKETS[j.country]?j.country:'NG',currency:'NGN'}}}catch(e){market={country:'NG',currency:'NGN'}}localStorage.setItem('grimMarket',JSON.stringify(market));updateMarketUI()}

const FALLBACK_CATALOG=[{"id":1,"name":"Rose Reaper","type":"Hoodie","price":28000,"color":"Pink"},{"id":2,"name":"Veil","type":"Hoodie","price":28000,"color":"White"},{"id":3,"name":"Abyss","type":"Hoodie","price":28000,"color":"Blue"},{"id":4,"name":"Eclipse Gold","type":"Hoodie","price":28000,"color":"Yellow"},{"id":5,"name":"Rose Reaper","type":"Hoodie","price":28000,"color":"Pink"},{"id":6,"name":"Eclipse Gold","type":"Armless","price":15000,"color":"Yellow"},{"id":7,"name":"Bloodline","type":"Hoodie","price":28000,"color":"Red"},{"id":8,"name":"Obsidian","type":"Armless","price":15000,"color":"Black"},{"id":10,"name":"Obsidian / Veil","type":"Tee","price":18000,"color":"Mixed"},{"id":11,"name":"Veil / Abyss","type":"Hoodie","price":28000,"color":"Mixed"},{"id":12,"name":"Veil","type":"Tee","price":18000,"color":"White"},{"id":13,"name":"Veil / Abyss / Obsidian","type":"Armless","price":15000,"color":"Mixed"},{"id":14,"name":"Void Violet","type":"Hoodie","price":28000,"color":"Purple"},{"id":15,"name":"Veil / Obsidian","type":"Hoodie","price":28000,"color":"Mixed"},{"id":16,"name":"Obsidian / Veil","type":"Hoodie","price":28000,"color":"Mixed"},{"id":17,"name":"Rose Reaper","type":"Hoodie","price":28000,"color":"Pink"},{"id":18,"name":"Obsidian","type":"Hoodie","price":28000,"color":"Black"},{"id":19,"name":"Abyss","type":"Hoodie","price":28000,"color":"Blue"},{"id":20,"name":"Void Violet","type":"Hoodie","price":28000,"color":"Purple"},{"id":21,"name":"Rose Reaper","type":"Tee","price":18000,"color":"Pink"},{"id":22,"name":"Veil","type":"Hoodie","price":28000,"color":"White"},{"id":23,"name":"Obsidian","type":"Tee","price":18000,"color":"Black"},{"id":24,"name":"Veil / Obsidian","type":"Complete GRIM Outfit","price":90000,"color":"Mixed"},{"id":25,"name":"Obsidian","type":"Hoodie","price":28000,"color":"Black"},{"id":26,"name":"Rose Reaper","type":"Hoodie","price":28000,"color":"Pink"}];
let catalog=FALLBACK_CATALOG.slice(),mode='login',shopPage=1;
const E=id=>document.getElementById(id),M=n=>money(n);
const storedCart=JSON.parse(localStorage.getItem('grimCart')||'[]');
let cart=storedCart.map(x=>{const p=catalog.find(v=>v.id==x.id);return p?{...p,size:x.size||'M',qty:Math.max(1,+x.qty||1)}:null}).filter(Boolean);
function save(){localStorage.setItem('grimCart',JSON.stringify(cart))}
function productVisual(p){return p.image||(window.GRIM_DESIGNS||[])[p.id-1]||'/assets/grim-wordmark.png'}
function render(){const root=E('products');if(!root)return;let q=(E('search')?.value||'').toLowerCase(),cat=E('category')?.value||'all',col=E('color')?.value||'all',sort=E('sort')?.value||'featured';let list=catalog.filter(p=>(!q||`${p.name} ${p.color} ${p.type} ravkael`.toLowerCase().includes(q))&&(cat==='all'||p.type===cat)&&(col==='all'||p.color===col));if(sort==='low')list.sort((a,b)=>a.price-b.price);if(sort==='high')list.sort((a,b)=>b.price-a.price);const per=8,pages=Math.max(1,Math.ceil(list.length/per));shopPage=Math.min(shopPage,pages);let shown=list.slice((shopPage-1)*per,shopPage*per);E('resultCount').textContent=`${list.length} PIECES · PAGE ${shopPage} OF ${pages}`;root.innerHTML=shown.map(p=>`<article class="card"><div class="pic"><img src="${productVisual(p)}" loading="lazy" alt="${p.name} ${p.type}"><span class="type-pill">${p.type}</span></div><div class="info"><p class="colorway">${p.color} · RAV’KAEL</p><div class="info-row"><h3>${p.name}</h3><b>${M(p.price)}</b></div><small class="product-type">${p.type}</small><label class="size-label">SIZE <select id="size-${p.id}"><option>S</option><option selected>M</option><option>L</option><option>XL</option><option>XXL</option></select></label><button onclick="add(${p.id})">ADD TO CART 🛒</button></div></article>`).join('')||'<p class="empty-note">No pieces match your filters.</p>';let pg=E('pagination');if(pg)pg.innerHTML=pages>1?`<button ${shopPage===1?'disabled':''} onclick="shopPage--;render();scrollToShop()">← PREVIOUS</button><span>${shopPage} / ${pages}</span><button ${shopPage===pages?'disabled':''} onclick="shopPage++;render();scrollToShop()">NEXT →</button>`:''}
async function init(){
  await detectMarket();
  catalog=FALLBACK_CATALOG.slice();
  try{const r=await fetch('/api/products',{cache:'no-store'});if(r.ok){const live=await r.json();if(Array.isArray(live)&&live.length)catalog=live}}catch(e){}
  cart=cart.map(x=>{const p=catalog.find(v=>v.id==x.id);return p?{...p,size:x.size||'M',qty:Math.max(1,+x.qty||1)}:null}).filter(Boolean);save();
  const colorSelect=E('color');
  if(colorSelect){
    const colors=[...new Set(catalog.map(p=>p.color))];
    colorSelect.innerHTML='<option value="all">All colorways</option>'+colors.map(c=>`<option value="${c}">${c}</option>`).join('');
  }
  render();
  ['search','category','color','sort'].forEach(id=>E(id)?.addEventListener(id==='search'?'input':'change',()=>{shopPage=1;render()}));
  try{let u=await fetch('/api/me').then(r=>r.json());if(u&&E('acct'))E('acct').textContent=u.name.toUpperCase()}catch(e){}
  draw();
}
function add(id){let p=catalog.find(v=>v.id==id);if(!p)return;let size=E('size-'+id)?.value||'M',x=cart.find(v=>v.id==id&&v.size===size);x?x.qty++:cart.push({...p,size,qty:1});save();draw();openBag()}
function qty(i,d){cart[i].qty+=d;if(cart[i].qty<1)cart.splice(i,1);save();draw()}
function removeItem(i){cart.splice(i,1);save();draw()}
function draw(){if(E('count'))E('count').textContent=cart.reduce((a,x)=>a+x.qty,0);if(E('items'))E('items').innerHTML=cart.map((x,i)=>`<div class="cart-line"><img src="${productVisual(x)}"><div><b>${x.name}</b><small>${x.color} · ${x.size}</small><div class="qty"><button onclick="qty(${i},-1)">−</button><span>${x.qty}</span><button onclick="qty(${i},1)">+</button><button class="remove" onclick="removeItem(${i})">REMOVE</button></div></div><strong>${M(x.price*x.qty)}</strong></div>`).join('')||'<p>Your bag is empty.</p>';if(E('total'))E('total').textContent=M(cart.reduce((a,x)=>a+x.price*x.qty,0))}
function openBag(){E('bag')?.classList.add('open')}function closeBag(){E('bag')?.classList.remove('open')}function openAuth(){E('auth')?.classList.add('open')}function closeAuth(){E('auth')?.classList.remove('open')}function setMode(x){
  mode = x;

  const registering = x === 'register';

  const nameFields = E('authNameFields');
  const phone = E('aPhone');
  const phoneWrap = phone?.closest('.auth-phone-wrap');
  const confirm = E('aConfirm');
  const rules = E('passwordRules');
  const pass = E('aPass');

  if(nameFields){
    nameFields.style.display = registering ? 'grid' : 'none';
  }

  if(phoneWrap){
    phoneWrap.style.display = registering ? 'block' : 'none';
  }

  if(confirm){
    confirm.style.display = registering ? 'block' : 'none';
    confirm.required = registering;
    if(!registering) confirm.value = '';
  }

  if(rules){
  rules.style.display = 'none';
}

  if(E('aFirst')) E('aFirst').required = registering;
  if(E('aLast')) E('aLast').required = registering;
  if(phone) phone.required = registering;

  if(pass){
    pass.autocomplete = registering ? 'new-password' : 'current-password';
  }

  if(E('aMsg')){
    E('aMsg').textContent = '';
  }

  updateGrimPasswordRules();
}
  async function openCheckout(){
  if(!cart.length) return;

  try{
    const response = await fetch('/api/me', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    });

    let user = null;

    if(response.ok){
      try{
        user = await response.json();
      }catch(e){
        user = null;
      }
    }

    if(!response.ok || !user || !user.email){
      E('bag')?.classList.remove('open');

      if(typeof setMode === 'function'){
        setMode('login');
      }

      E('auth')?.classList.add('open');
      return;
    }

  }catch(error){
    E('bag')?.classList.remove('open');

    if(typeof setMode === 'function'){
      setMode('login');
    }

    E('auth')?.classList.add('open');
    return;
  }

  E('bag')?.classList.remove('open');

  if(!E('grimCheckoutForm')){
    buildGrimCheckout();
  }

  const form = E('grimCheckoutForm');
  const payment = E('paymentStep');

  if(form) form.style.display = 'block';
  if(payment) payment.style.display = 'none';

  E('checkout')?.classList.add('open');
}
function closeCheckout(){
  E('checkout')?.classList.remove('open');

  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
}
// ===== GRIM LIVE PASSWORD CHECK =====
const grimPass = E('aPass');
const grimConfirm = E('aConfirm');

function grimPasswordRule(id, passed, label, touched = true){
  const el = E(id);
  if(!el) return;

  if(!touched){
    el.textContent = `○ ${label}`;
    el.style.color = '#777';
    return;
  }

  if(passed){
    el.textContent = `✓ ${label}`;
    el.style.color = '#168a45';
  }else{
    el.textContent = `○ ${label}`;
    el.style.color = '#777';
  }
}

function updateGrimPasswordRules(){
  const password = grimPass?.value || '';
  const confirmPassword = grimConfirm?.value || '';

  const touched = password.length > 0;

  grimPasswordRule(
    'ruleLength',
    password.length >= 8,
    'At least 8 characters',
    touched
  );

  grimPasswordRule(
    'ruleUpper',
    /[A-Z]/.test(password),
    'One uppercase letter',
    touched
  );

  grimPasswordRule(
    'ruleLower',
    /[a-z]/.test(password),
    'One lowercase letter',
    touched
  );

  grimPasswordRule(
    'ruleNumber',
    /[0-9]/.test(password),
    'One number',
    touched
  );

  grimPasswordRule(
    'ruleSpecial',
    /[^A-Za-z0-9]/.test(password),
    'One special character',
    touched
  );

  grimPasswordRule(
    'ruleMatch',
    confirmPassword.length > 0 && password === confirmPassword,
    'Passwords match',
    confirmPassword.length > 0
  );
}

function showGrimPasswordRules(){
  const rules = E('passwordRules');

  if(mode !== 'register' || !rules) return;

  rules.style.display = 'flex';
  rules.style.flexDirection = 'column';
  rules.style.alignItems = 'flex-start';
  rules.style.gap = '6px';
  rules.style.margin = '10px 0 14px';
  rules.style.fontSize = '13px';
  rules.style.lineHeight = '1.4';
}

function hideGrimPasswordRules(){
  setTimeout(() => {
    const active = document.activeElement;

    if(
      active !== grimPass &&
      active !== grimConfirm &&
      E('passwordRules')
    ){
      E('passwordRules').style.display = 'none';
    }
  }, 100);
}

grimPass?.addEventListener('focus', showGrimPasswordRules);
grimConfirm?.addEventListener('focus', showGrimPasswordRules);

grimPass?.addEventListener('input', () => {
  showGrimPasswordRules();
  updateGrimPasswordRules();
});

grimConfirm?.addEventListener('input', () => {
  showGrimPasswordRules();
  updateGrimPasswordRules();
});

grimPass?.addEventListener('blur', hideGrimPasswordRules);
grimConfirm?.addEventListener('blur', hideGrimPasswordRules);

updateGrimPasswordRules();
setMode('login');
if(E('authForm')) E('authForm').onsubmit = async e => {
  e.preventDefault();

  const email = (E('aEmail')?.value || '').trim().toLowerCase();
  const password = E('aPass')?.value || '';
  const msg = E('aMsg');

  if(msg) msg.textContent = '';

  let payload = {
    email,
    password
  };

  if(mode === 'register'){
    const firstName = (E('aFirst')?.value || '').trim();
    const lastName = (E('aLast')?.value || '').trim();
    const phone = (E('aPhone')?.value || '').trim();
    const confirmPassword = E('aConfirm')?.value || '';

    const validPassword =
      password.length >= 8 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[^A-Za-z0-9]/.test(password);

    if(!firstName || !lastName){
      if(msg) msg.textContent = 'Enter your first and last name.';
      return;
    }

    if(!email){
      if(msg) msg.textContent = 'Enter your email address.';
      return;
    }

    if(!phone){
      if(msg) msg.textContent = 'Enter your phone number.';
      return;
    }

    if(!validPassword){
      if(msg) msg.textContent = 'Complete all password requirements.';
      return;
    }

    if(password !== confirmPassword){
      if(msg) msg.textContent = 'Passwords do not match.';
      return;
    }

    payload = {
      name: `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
      email,
      phone,
      password
    };
  }

  try{
    const r = await fetch('/api/' + mode, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    const j = await r.json();

    if(!r.ok){
      if(msg) msg.textContent = j.error || 'Unable to continue.';
      return;
    }

    if(msg){
      msg.textContent =
        mode === 'register'
          ? 'ACCOUNT CREATED.'
          : 'WELCOME BACK.';
    }

    if(E('acct') && j.name){
      E('acct').textContent = j.name.toUpperCase();
    }

    setTimeout(closeAuth, 600);

  }catch(error){
    console.error('GRIM account error:', error);

    if(msg){
      msg.textContent = 'Unable to connect. Please try again.';
    }
  }
};
if(E('orderForm'))E('orderForm').onsubmit=async e=>{e.preventDefault();let r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:E('oName').value,email:E('oEmail').value,phone:E('oPhone').value,address:E('oAddress').value,country:market.country,currency:market.currency,items:cart.map(x=>({id:x.id,qty:x.qty,size:x.size}))})}),j=await r.json();if(r.ok){E('oMsg').textContent=`ORDER #${j.orderId} RECEIVED — ${M(j.total)}`;cart=[];save();draw();E('orderForm').reset()}else E('oMsg').textContent=j.error};setMode('login');init();

function toggleMobile(){E('mobileNav')?.classList.toggle('open')}
function openSearch(){E('search')?.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>E('search')?.focus(),500)}
function quickSearch(q){let s=E('search');if(s){s.value=q;render();s.scrollIntoView({behavior:'smooth',block:'center'})}}
function clearFilters(){if(E('search'))E('search').value='';if(E('category'))E('category').value='all';if(E('color'))E('color').value='all';if(E('sort'))E('sort').value='featured';render()}
function openHelp(kind='general'){let map={order:'ORDER SUPPORT',size:'SIZE HELP',delivery:'DELIVERY SUPPORT',general:'CONTACT GRIM'};if(E('helpTitle'))E('helpTitle').textContent=map[kind]||map.general;if(E('helpTopic'))E('helpTopic').value=kind==='order'?'Order support':kind==='size'?'Size help':kind==='delivery'?'Delivery':'Other';E('helpModal')?.classList.add('open')}
function closeHelp(){E('helpModal')?.classList.remove('open')}
if(E('helpForm'))E('helpForm').onsubmit=async e=>{e.preventDefault();let r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:E('helpTopic').value,name:E('hName').value,email:E('hEmail').value,order:E('hOrder').value,message:E('hMessage').value})}),j=await r.json();E('hMsg').textContent=r.ok?`MESSAGE RECEIVED — SUPPORT #${j.ticketId}`:(j.error||'Please try again.');if(r.ok)E('helpForm').reset()};
if(E('newsForm'))E('newsForm').onsubmit=async e=>{e.preventDefault();let r=await fetch('/api/newsletter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:E('newsEmail').value})}),j=await r.json();E('newsMsg').textContent=r.ok?'WELCOME TO THE HOUSE.':(j.error||'Please try again.');if(r.ok)E('newsForm').reset()};

function scrollToShop(){document.querySelector('.shop')?.scrollIntoView({behavior:'smooth',block:'start'})}
 // ===== GRIM CHECKOUT V2 =====
function buildGrimCheckout(){
  const box=document.querySelector('#checkout .checkout-box');
  if(!box)return;

  box.innerHTML=`
    <button class="x" onclick="closeCheckout()">×</button>
    <span class="eyebrow">SECURE CHECKOUT</span>
    <h2>CHECKOUT</h2>

    <div style="display:flex;gap:8px;margin:15px 0 25px;font-size:12px">
      <b>1 BAG</b> → <b>2 DELIVERY</b> → <b>3 PAYMENT</b>
    </div>

    <form id="grimCheckoutForm">

      <h3>CONTACT</h3>
      <input id="coEmail" type="email" required placeholder="Email address">
      <input id="coPhone" type="tel" required placeholder="Phone number">

      <h3>DELIVERY ADDRESS</h3>

      <select id="coCountry" required>
        <option value="NG">Nigeria</option>
        <option value="US">United States</option>
        <option value="GB">United Kingdom</option>
        <option value="CA">Canada</option>
        <option value="GH">Ghana</option>
        <option value="ZA">South Africa</option>
        <option value="KE">Kenya</option>
        <option value="AE">United Arab Emirates</option>
      </select>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <input id="coFirst" required placeholder="First name">
        <input id="coLast" required placeholder="Last name">
      </div>

      <input id="coAddress" required placeholder="Street address">
      <div id="addressSuggestions"></div>
      <input id="coApartment" placeholder="Apartment, suite, etc. (optional)">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <input id="coCity" required placeholder="City">
        <input id="coState" required placeholder="State / Province">
      </div>

      <input id="coPostal" placeholder="Postal / ZIP code">
      <textarea id="coInstructions"
        placeholder="Delivery instructions (optional)"></textarea>

      <h3>DELIVERY METHOD</h3>

      <label style="display:block;border:1px solid #bbb;padding:16px;margin:10px 0">
        <input type="radio" name="delivery" value="standard" checked>
        <b> Standard Delivery</b><br>
        <small>Delivery cost will be calculated for your destination.</small>
      </label>

      <button class="dark full" type="submit">
        CONTINUE TO PAYMENT
      </button>

      <p id="checkoutMessage"></p>
    </form>

    <div id="paymentStep" style="display:none">
      <h3>PAYMENT</h3>
      <p class="muted">Choose how you would like to pay.</p>

      <button class="dark full" id="payCard" type="button">
        💳 PAY WITH CARD
      </button>

      <button class="dark full" id="payTransfer"
        type="button" style="margin-top:12px">
        🏦 PAY BY BANK TRANSFER
      </button>

      <button type="button" id="backDelivery"
        style="margin-top:18px">
        ← BACK TO DELIVERY
      </button>

      <p id="paymentMessage"></p>
    </div>
  `;


const addressInput = E('coAddress');
const suggestions = E('addressSuggestions');
let addressTimer;

addressInput.addEventListener('input', function () {
  clearTimeout(addressTimer);

  const query = this.value.trim();
  if (query.length < 3) {
    suggestions.innerHTML = '';
    suggestions.style.display = 'none';
    return;
  }

  addressTimer = setTimeout(async () => {
    try {
      const countryCode = E('coCountry')?.value || '';

      const url =
        'https://photon.komoot.io/api/?q=' +
        encodeURIComponent(query) +
        '&limit=5' +
        (countryCode ? '&countrycode=' + encodeURIComponent(countryCode) : '');

      const response = await fetch(url);
      if (!response.ok) throw new Error('Address search failed');

      const data = await response.json();

      suggestions.innerHTML = '';

      if (!data.features || !data.features.length) {
        suggestions.style.display = 'none';
        return;
      }

      data.features.forEach(feature => {
        const p = feature.properties || {};

        const street = [p.housenumber, p.street || p.name]
          .filter(Boolean)
          .join(' ');

        const city =
    p.city ||
    p.town ||
    p.village ||
    p.locality ||
    p.municipality ||
    p.suburb ||
    '';

        const state = p.state || '';
        const postcode = p.postcode || '';

        const label = [
          street,
          city,
          state,
          postcode,
          p.country
        ].filter(Boolean).join(', ');

        const option = document.createElement('div');
        option.textContent = label;

        option.style.padding = '14px';
        option.style.cursor = 'pointer';
        option.style.borderBottom = '1px solid #ddd';
        option.style.background = '#fff';

  option.addEventListener('click', async () => {
  addressInput.value = street || p.name || query;

  let finalCity = city;
  let finalState = state;
  let finalPostcode = postcode;

  // If Photon search didn't return complete address details,
  // use the selected result's coordinates to reverse-geocode it.
  try {
    const coords = feature.geometry?.coordinates;

    if (coords && coords.length >= 2) {
      const lon = coords[0];
      const lat = coords[1];

      const reverseURL =
        'https://photon.komoot.io/reverse?lon=' +
        encodeURIComponent(lon) +
        '&lat=' +
        encodeURIComponent(lat);

      const reverseResponse = await fetch(reverseURL);

      if (reverseResponse.ok) {
        const reverseData = await reverseResponse.json();
        const rp = reverseData.features?.[0]?.properties || {};

        finalCity =
          finalCity ||
          rp.city ||
          rp.town ||
          rp.village ||
          rp.locality ||
          rp.district ||
          '';

        finalState =
          finalState ||
          rp.state ||
          '';

        finalPostcode =
          finalPostcode ||
          rp.postcode ||
          '';
      }
    }
  } catch (error) {
    console.error('GRIM reverse address lookup failed:', error);
  }
// GRIM ZIP fallback - fills city/state when Photon leaves them blank
if (!finalCity && finalPostcode) {
  try {
    const selectedCountry = E('coCountry')?.value || '';

    if (selectedCountry === 'US') {
      const zipResponse = await fetch(
        'https://api.zippopotam.us/us/' +
        encodeURIComponent(finalPostcode)
      );

      if (zipResponse.ok) {
        const zipData = await zipResponse.json();
        const place = zipData.places?.[0];

        if (place) {
          finalCity = place['place name'] || finalCity;
          finalState = place['state'] || finalState;
        }
      }
    }
  } catch (error) {
    console.error('GRIM ZIP lookup failed:', error);
  }
}
  if (E('coCity')) E('coCity').value = finalCity;
  if (E('coState')) E('coState').value = finalState;
  if (E('coPostal')) E('coPostal').value = finalPostcode;

  suggestions.innerHTML = '';
  suggestions.style.display = 'none';
});
        suggestions.appendChild(option);
      });

      suggestions.style.display = 'block';

    } catch (error) {
      console.error('GRIM address search:', error);
      suggestions.style.display = 'none';
    }
  }, 400);
});  
  const country=E('coCountry');
  if(market?.country && [...country.options].some(o=>o.value===market.country)){
    country.value=market.country;
  }

  function paymentAvailability(){
    const transfer=E('payTransfer');
    if(transfer){
      transfer.style.display=
        country.value==='NG' ? 'block' : 'none';
    }
  }

  paymentAvailability();
  country.addEventListener('change',paymentAvailability);

  E('grimCheckoutForm').onsubmit=e=>{
    e.preventDefault();

    E('grimCheckoutForm').style.display='none';
    E('paymentStep').style.display='block';

    paymentAvailability();

    box.scrollTop=0;
  };

  E('backDelivery').onclick=()=>{
    E('paymentStep').style.display='none';
    E('grimCheckoutForm').style.display='block';
  };

  E('payCard').onclick=()=>{
    E('paymentMessage').textContent=
      'Preparing secure card payment…';
    startGrimPayment('card');
  };

  E('payTransfer').onclick=()=>{
    E('paymentMessage').textContent=
      'Preparing secure bank transfer…';
    startGrimPayment('bank_transfer');
  };
}

function startGrimPayment(method) {
  const email = E('coEmail').value.trim();
  const firstName = E('coFirst').value.trim();
  const lastName = E('coLast').value.trim();
  const phone = E('coPhone').value.trim();

  const total = cart.reduce(
    (sum, item) => sum + (item.price * item.qty),
    0
  );

  if (!email) {
    E('paymentMessage').textContent =
      'Please enter your email address before payment.';
    return;
  }

  if (total <= 0) {
    E('paymentMessage').textContent =
      'Your bag is empty.';
    return;
  }

  const popup = new PaystackPop();

  popup.newTransaction({
    key: 'pk_live_c4fc8a994bea77b16ffffe9c2372c94a393ce7e3',
    email: email,
    amount: Math.round(total * 100),
    currency: 'NGN',

    firstName: firstName,
    lastName: lastName,
    phone: phone,

    channels:
      method === 'bank_transfer'
        ? ['bank_transfer']
        : ['card'],

    metadata: {
      custom_fields: [
        {
          display_name: 'GRIM Customer',
          variable_name: 'grim_customer',
          value: `${firstName} ${lastName}`.trim()
        }
      ]
    },

    onSuccess: async (transaction) => {
    E('paymentMessage').textContent = 'Verifying payment…';
      window.GRIMPaymentStatus?.save(transaction.reference, Math.round(total * 100));

    try {
        const response = await fetch(
            'https://rlwslim-code-github-io.vercel.app/api/payments/verify',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    reference: transaction.reference
                })
            }
        );

        const result = await response.json();

        if (response.ok && result.verified) {
            E('paymentMessage').textContent =
                'Payment verified ✓ Reference: ' + transaction.reference;

            console.log('GRIM verified payment:', result);
        } else {
            E('paymentMessage').textContent =
                'Payment could not be verified. Please contact GRIM support.';

            console.error('Verification failed:', result);
        }

    } catch (error) {
        E('paymentMessage').textContent =
            'Payment verification error. Please contact GRIM support.';

        console.error('Verification error:', error);
    }
},

    onCancel: () => {
      E('paymentMessage').textContent =
        'Payment cancelled. You can try again.';
    },

    onError: (error) => {
      console.error('Paystack error:', error);

      E('paymentMessage').textContent =
        'Payment could not start. Please try again.';
    }
  });
}

buildGrimCheckout();

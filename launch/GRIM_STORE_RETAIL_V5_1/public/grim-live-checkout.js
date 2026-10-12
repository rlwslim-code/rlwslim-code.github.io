(() => {
  const API = new URL(window.location.href).hostname.endsWith('.vercel.app')
    ? '/api/payments'
    : 'https://rlwslim-code-github-io.vercel.app/api/payments';
  const KEY = 'grimPendingCheckout';
  const validReference = value => /^GRIM-[a-f0-9]{32}$/.test(value || '');
  let pending = null;
  let busy = false;
  try { pending = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch {}
  if (!validReference(pending?.reference)) pending = null;
  function remember(value) {
    pending = value;
    try {
      if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
      else sessionStorage.removeItem(KEY);
    } catch {}
  }
  function message(text) {
    const element = document.getElementById('paymentMessage');
    if (element) element.textContent = text;
  }
  function lock(value) {
    busy = value;
    for (const id of ['payCard', 'payTransfer', 'backDelivery']) {
      const element = document.getElementById(id);
      if (element) element.disabled = value;
    }
  }
  function basket(items) {
    return JSON.stringify(items.map(item => ({id: Number(item.id), qty: Number(item.qty), size: item.size})).sort((a, b) => a.id - b.id || a.size.localeCompare(b.size)));
  }
  async function request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${API}/${path}`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body), signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Payment is unavailable. Please contact GRIM Customer Care.');
      return result;
    } finally { clearTimeout(timeout); }
  }
  function paymentURL(value) {
    const url = new URL(value);
    if (url.origin !== 'https://checkout.paystack.com' || url.username || url.password) throw new Error('Invalid checkout link. Please contact GRIM Customer Care.');
    return url.href;
  }
  function showReference(reference, amount) {
    window.GRIMPaymentStatus?.save(reference, amount);
  }
  function complete(result) {
    if (!result.verified || !result.orderVerified || result.status !== 'success' || result.currency !== 'NGN' || !Number.isSafeInteger(result.amount) || result.amount <= 0) return false;
    if (pending?.reference === result.reference) {
      if (pending.amount !== result.amount) throw new Error('The payment amount does not match this bag. Contact Customer Care.');
      // A different bag added while away from the website must stay intact.
      if (typeof cart !== 'undefined' && basket(cart) === pending.basket) {
        cart = [];
        save();
        draw();
      }
      remember(null);
    }
    showReference(result.reference, result.amount);
    message(`Payment verified ✓ Reference: ${result.reference}`);
    return true;
  }

  // Reuse the checkout already present on the homepage for the Shop and Story cart modals.
  if (typeof buildGrimCheckout === 'function' && !document.getElementById('grimCheckoutForm')) {
    const box = document.querySelector('#checkout .box');
    if (box) { box.classList.add('checkout-box'); buildGrimCheckout(); }
  }
  const form = document.getElementById('grimCheckoutForm');
  if (form && typeof cart !== 'undefined') {
    window.startGrimPayment = async function (method) {
      if (busy) return;
      lock(true);
      try {
        if (!form.checkValidity()) {
          form.style.display = 'block';
          document.getElementById('paymentStep').style.display = 'none';
          form.reportValidity();
          return;
        }
        if (!cart.length) throw new Error('Your bag is empty.');
        const value = id => document.getElementById(id)?.value.trim() || '';
        const payload = {
          method,
          expectedAmount: Math.round(cart.reduce((sum, item) => sum + item.price * item.qty, 0) * 100),
          customer: {email: value('coEmail'), firstName: value('coFirst'), lastName: value('coLast'), phone: value('coPhone')},
          delivery: {country: value('coCountry'), address: value('coAddress'), apartment: value('coApartment'), city: value('coCity'), state: value('coState'), postal: value('coPostal'), instructions: value('coInstructions')},
          items: cart.map(item => ({id: Number(item.id), qty: Number(item.qty), size: item.size}))
        };
        // Store a digest, reference and basket IDs, without retaining the delivery address on this device.
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
        const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (pending?.fingerprint === fingerprint) {
          const result = await request('verify', {reference: pending.reference});
          if (result.reference !== pending.reference) throw new Error('Payment reference mismatch. Contact Customer Care.');
          if (complete(result)) return;
          message('Reopening your existing Paystack checkout…');
          window.location.assign(paymentURL(pending.authorizationUrl));
          return;
        }
        message('Preparing secure Paystack checkout…');
        const result = await request('initialize', payload);
        if (!validReference(result.reference) || result.amount !== payload.expectedAmount || result.currency !== 'NGN' || !['live', 'test'].includes(result.mode)) throw new Error('The checkout details changed. Review your bag before paying.');
        const authorizationUrl = paymentURL(result.authorizationUrl);
        remember({reference: result.reference, amount: result.amount, authorizationUrl, fingerprint, basket: basket(cart)});
        // Keep the existing receipt launcher available even if the customer cancels or closes Paystack.
        window.location.assign(authorizationUrl);
      } catch (error) {
        message(error.name === 'AbortError' ? 'Payment preparation timed out. If you already paid, use PAYMENT STATUS before paying again.' : error.message);
      } finally { lock(false); }
    };
    const description = document.querySelector('#paymentStep .muted');
    if (description) description.textContent = 'Pay securely with Paystack in NGN. This payment covers your products; delivery cost is quoted separately.';
    window.GRIMLiveCheckoutReady = true;
  }

  const params = new URLSearchParams(window.location.search);
  const returning = params.get('grim-payment');
  const reference = returning === 'cancel' ? pending?.reference : params.get('reference') || params.get('trxref');
  if (returning && validReference(reference)) {
    lock(true);
      request('verify', {reference}).then(result => {
      if (result.reference !== reference) throw new Error('Payment reference mismatch. Contact Customer Care.');
      if (!complete(result)) message(`Payment not confirmed. Reference: ${reference}. Use PAYMENT STATUS before paying again.`);
    }).catch(error => message(`Keep reference ${reference}. ${error.name === 'AbortError' ? 'The check timed out. Check PAYMENT STATUS before paying again.' : error.message}`)).finally(() => lock(false));
    const clean = new URL(window.location.href);
    for (const key of ['grim-payment', 'reference', 'trxref']) clean.searchParams.delete(key);
    window.history.replaceState(null, '', clean.href);
  }
})();

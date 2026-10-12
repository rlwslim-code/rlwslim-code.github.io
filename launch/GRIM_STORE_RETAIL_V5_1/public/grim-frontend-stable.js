/* GRIM frontend stabilization layer
   Frontend-only stage: auth/checkout UX, phone codes, mobile behavior.
   Payment and Google OAuth connections are intentionally paused until the UI is signed off.
*/
(() => {
  const $ = id => document.getElementById(id);

  const COUNTRY_DIALS = {
    NG: ['Nigeria', '+234'],
    US: ['United States', '+1'],
    GB: ['United Kingdom', '+44'],
    CA: ['Canada', '+1'],
    AU: ['Australia', '+61'],
    DE: ['Germany', '+49'],
    FR: ['France', '+33'],
    IT: ['Italy', '+39'],
    ES: ['Spain', '+34'],
    NL: ['Netherlands', '+31'],
    GH: ['Ghana', '+233'],
    ZA: ['South Africa', '+27'],
    KE: ['Kenya', '+254'],
    AE: ['United Arab Emirates', '+971'],
    JP: ['Japan', '+81']
  };

  let pendingCheckout = false;
  let authMode = 'login';

  const countryFlag = code =>
  code.replace(/./g, char =>
    String.fromCodePoint(127397 + char.charCodeAt())
  );

const countryOptions = selected => Object.entries(COUNTRY_DIALS)
  .map(([code, [, dial]]) =>
    `<option value="${code}" ${code === selected ? 'selected' : ''}>${countryFlag(code)} ${dial}</option>`
  ).join('');

  function selectedMarketCountry() {
    try {
      const saved = JSON.parse(localStorage.getItem('grimMarket') || 'null');
      if (saved?.country && COUNTRY_DIALS[saved.country]) return saved.country;
    } catch (_) {}
    return 'NG';
  }

  function normalizePhone(number, countryCode) {
    let value = String(number || '').trim().replace(/[^\d+]/g, '');
    if (!value) return '';
    if (value.startsWith('+')) return value;
    value = value.replace(/^0+/, '');
    const dial = COUNTRY_DIALS[countryCode]?.[1] || '+234';
    return `${dial}${value}`;
  }

  function enhanceAuthPhone() {
    const input = $('aPhone');
    if (!input || $('aPhoneCode')) return;

    const wrap = input.closest('.auth-phone-wrap');
    if (!wrap) return;

    const row = document.createElement('div');
    row.className = 'grim-phone-row';

    const select = document.createElement('select');
    select.id = 'aPhoneCode';
    select.setAttribute('aria-label', 'Phone country code');
    select.innerHTML = countryOptions(selectedMarketCountry());

    input.placeholder = 'Phone number';
    input.inputMode = 'tel';

    wrap.innerHTML = '';
    row.append(select, input);
    wrap.append(row);
  }

  function addCheckoutCountries() {
    const country = $('coCountry');
    if (!country) return;

    const existing = new Set([...country.options].map(o => o.value));
    for (const [code, [name]] of Object.entries(COUNTRY_DIALS)) {
      if (!existing.has(code)) {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = name;
        country.appendChild(option);
      }
    }
  }

  function enhanceCheckoutPhone() {
    const input = $('coPhone');
    const country = $('coCountry');
    if (!input || !country) return;

    addCheckoutCountries();

    if (!$('coPhoneCode')) {
      const row = document.createElement('div');
      row.className = 'grim-phone-row';

      const select = document.createElement('select');
      select.id = 'coPhoneCode';
      select.setAttribute('aria-label', 'Phone country code');
      select.innerHTML = countryOptions(country.value || selectedMarketCountry());

      input.parentNode.insertBefore(row, input);
      row.append(select, input);

      country.addEventListener('change', () => {
        if ($('coPhoneCode') && COUNTRY_DIALS[country.value]) {
          $('coPhoneCode').value = country.value;
        }
      });
    }

    if (COUNTRY_DIALS[country.value] && $('coPhoneCode')) {
      $('coPhoneCode').value = country.value;
    }
  }

  function pausePaymentsForFrontendStage() {
    const message = $('paymentMessage');
    const note = document.querySelector('#paymentStep .muted');
    if (note) {
      note.textContent = 'Payment connection will be enabled after the frontend is signed off.';
    }

    const explain = () => {
      if (message) {
        message.textContent = 'Frontend test complete up to payment. Paystack will be connected in the integration stage.';
      }
    };

    for (const id of ['payCard', 'payTransfer']) {
      const button = $(id);
      if (!button) continue;
      button.onclick = explain;
      button.dataset.frontendStage = 'true';
    }
  }

  function enhanceCheckout() {
    enhanceCheckoutPhone();
     }

  const originalBuildCheckout = typeof window.buildGrimCheckout === 'function'
    ? window.buildGrimCheckout
    : null;

  if (originalBuildCheckout) {
    window.buildGrimCheckout = function () {
      originalBuildCheckout();
      enhanceCheckout();
    };
  }
     // ===== GRIM LIVE SESSION HEARTBEAT =====
async function sendGrimHeartbeat() {
  try {
    await fetch('/api/session/heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify({
        path: window.location.pathname + window.location.search
      })
    });
  } catch (_) {
    // Tracking must never interrupt the customer experience.
  }
}

sendGrimHeartbeat();

setInterval(() => {
  if (document.visibilityState === 'visible') {
    sendGrimHeartbeat();
  }
}, 60000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    sendGrimHeartbeat();
  }
});
  // app.js builds checkout once at load, so enhance that copy too.
  enhanceCheckout();

  const originalSetMode = typeof window.setMode === 'function' ? window.setMode : null;
  window.setMode = function (nextMode) {
    authMode = nextMode === 'register' ? 'register' : 'login';
    if (originalSetMode) originalSetMode(authMode);

    const rules = $('passwordRules');
    if (rules) rules.style.display = 'none';

    const google = $('grimGoogleButton');
    if (google) google.style.display = 'flex';
  };

  const originalCloseAuth = typeof window.closeAuth === 'function' ? window.closeAuth : null;
  window.closeAuth = function () {
    pendingCheckout = false;
    if (originalCloseAuth) originalCloseAuth();
    else $('auth')?.classList.remove('open');
  };

  function openLoginForCheckout() {
    pendingCheckout = true;
    try { window.closeBag?.(); } catch (_) {}
    window.setMode('login');
    $('auth')?.classList.add('open');
  }

  function prefillCheckout(user) {
    if (!user) return;

    const email = $('coEmail');
    const first = $('coFirst');
    const last = $('coLast');
    const phone = $('coPhone');

    if (email && user.email && !email.value) email.value = user.email;

    if (user.firstName && first && !first.value) first.value = user.firstName;
    if (user.lastName && last && !last.value) last.value = user.lastName;

    if ((!user.firstName || !user.lastName) && user.name) {
      const parts = String(user.name).trim().split(/\s+/);
      if (first && !first.value) first.value = parts.shift() || '';
      if (last && !last.value) last.value = parts.join(' ');
    }

    if (phone && user.phone && !phone.value) phone.value = user.phone;
  }

  window.openCheckout = async function () {
    if (typeof cart !== 'undefined' && !cart.length) return;

    let user = null;
    try {
      const response = await fetch('/api/me', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
      });

      if (response.ok) {
        try { user = await response.json(); } catch (_) {}
      }

      if (!response.ok || !user?.email) {
        openLoginForCheckout();
        return;
      }
    } catch (_) {
      openLoginForCheckout();
      return;
    }

    pendingCheckout = false;
    try { window.closeBag?.(); } catch (_) {}

    if (!$('grimCheckoutForm') && typeof window.buildGrimCheckout === 'function') {
      window.buildGrimCheckout();
    } else {
      enhanceCheckout();
    }

    prefillCheckout(user);

    const form = $('grimCheckoutForm');
    const payment = $('paymentStep');
    if (form) form.style.display = 'block';
    if (payment) payment.style.display = 'none';

    $('checkout')?.classList.add('open');
  };

  enhanceAuthPhone();

async function handleGoogleCredential(response) {
  const msg = $('aMsg');

  try {
    if (msg) msg.textContent = 'Signing in with Google...';

    const loginResponse = await fetch('/api/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({
        credential: response.credential
      })
    });

    const result = await loginResponse.json();

    if (!loginResponse.ok) {
      if (msg) msg.textContent = result.error || 'Google Sign-In failed.';
      return;
    }

    if (msg) msg.textContent = 'WELCOME TO GRIM.';

    if ($('acct')) {
      const label = result.name || result.email?.split('@')[0] || 'ACCOUNT';
      $('acct').textContent = String(label).toUpperCase();
    }

    const resume = pendingCheckout;
    pendingCheckout = false;

    if (originalCloseAuth) originalCloseAuth();
    else $('auth')?.classList.remove('open');

    if (resume) {
      setTimeout(() => window.openCheckout(), 150);
    }

  } catch (error) {
    console.error('GRIM Google Sign-In error:', error);
    if (msg) msg.textContent = 'Unable to sign in with Google.';
  }
}

async function setupGoogleSignIn() {
  const oldButton = $('grimGoogleButton');
  if (!oldButton) return;

  try {
    const configResponse = await fetch('/api/google-config', {
      credentials: 'include',
      cache: 'no-store'
    });

    const config = await configResponse.json();

    if (!config.clientId) {
      throw new Error('Missing Google Client ID');
    }

    if (!window.google?.accounts?.id) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    const googleContainer = document.createElement('div');
    googleContainer.id = 'grimGoogleRenderedButton';
    googleContainer.style.width = '100%';

    oldButton.replaceWith(googleContainer);

    google.accounts.id.initialize({
      client_id: config.clientId,
      callback: handleGoogleCredential
    });

    google.accounts.id.renderButton(
      googleContainer,
      {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: Math.min(400, googleContainer.parentElement?.clientWidth || 400)
      }
    );

  } catch (error) {
    console.error('GRIM Google setup error:', error);

    const msg = $('aMsg');
    if (msg) msg.textContent = 'Google Sign-In is temporarily unavailable.';
  }
}

setupGoogleSignIn();

  const authForm = $('authForm');
  if (authForm) {
    authForm.onsubmit = async event => {
      event.preventDefault();

      const email = ($('aEmail')?.value || '').trim().toLowerCase();
      const password = $('aPass')?.value || '';
      const msg = $('aMsg');
      if (msg) msg.textContent = '';

      let payload = { email, password };

      if (authMode === 'register') {
        const firstName = ($('aFirst')?.value || '').trim();
        const lastName = ($('aLast')?.value || '').trim();
        const confirmPassword = $('aConfirm')?.value || '';
        const phone = normalizePhone(
          $('aPhone')?.value || '',
          $('aPhoneCode')?.value || selectedMarketCountry()
        );

        const validPassword =
          password.length >= 8 &&
          /[A-Z]/.test(password) &&
          /[a-z]/.test(password) &&
          /[0-9]/.test(password) &&
          /[^A-Za-z0-9]/.test(password);

        if (!firstName || !lastName) {
          if (msg) msg.textContent = 'Enter your first and last name.';
          return;
        }
        if (!email) {
          if (msg) msg.textContent = 'Enter your email address.';
          return;
        }
        if (!phone) {
          if (msg) msg.textContent = 'Enter your phone number.';
          return;
        }
        if (!validPassword) {
          if (msg) msg.textContent = 'Complete all password requirements.';
          return;
        }
        if (password !== confirmPassword) {
          if (msg) msg.textContent = 'Passwords do not match.';
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

      try {
        const response = await fetch('/api/' + authMode, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });

        let result = {};
        try { result = await response.json(); } catch (_) {}

        if (!response.ok) {
          if (msg) msg.textContent = result.error || 'Unable to continue.';
          return;
        }

        if (msg) {
          msg.textContent = authMode === 'register' ? 'ACCOUNT CREATED.' : 'WELCOME BACK.';
        }

        if ($('acct')) {
          const label = result.name || payload.name || email.split('@')[0];
          if (label) $('acct').textContent = String(label).toUpperCase();
        }

        const resume = pendingCheckout;
        pendingCheckout = false;

        if (originalCloseAuth) originalCloseAuth();
        else $('auth')?.classList.remove('open');

        if (resume) {
          setTimeout(() => window.openCheckout(), 150);
        }
      } catch (error) {
        console.error('GRIM account error:', error);
        if (msg) msg.textContent = 'Unable to connect. Please try again.';
      }
    };
  }

  // Keep password rules hidden until a registration password field is active.
  const rules = $('passwordRules');
  if (rules) rules.style.display = 'none';

  // Default to Sign In without showing registration-only fields.
  window.setMode('login');

  // If checkout already exists from app.js, make sure the phone and payment stage are stabilized.
  enhanceCheckout();

  window.GRIMFrontendStable = true;
})();

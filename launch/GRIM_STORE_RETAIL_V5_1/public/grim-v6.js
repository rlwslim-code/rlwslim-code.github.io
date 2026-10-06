(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const fmt = n => "₦" + Number(n || 0).toLocaleString();

  const api = async (url, opt = {}) => {
    const r = await fetch(url, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(opt.headers || {})
      },
      ...opt
    });

    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || "Request failed");
    return b;
  };

  // Existing GRIM V6 stylesheet
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/grim-v6.css?v=7";
  document.head.append(css);

  // Extra layout styles for separated Wallet / FAQ
  const extra = document.createElement("style");
  extra.textContent = `
    .g6-top-area{
      width:min(1180px,92%);
      margin:22px auto 32px;
      display:grid;
      gap:18px;
    }

    .g6-wallet-home,
    .g6-faq-home{
      background:#090909;
      border:1px solid rgba(255,255,255,.14);
      border-radius:22px;
      padding:24px;
      color:#fff;
    }

    .g6-wallet-home small,
    .g6-faq-home small{
      display:block;
      letter-spacing:.24em;
      opacity:.65;
      margin-bottom:10px;
    }

    .g6-wallet-home h2,
    .g6-faq-home h2{
      margin:0 0 14px;
      letter-spacing:.08em;
    }

    .g6-wallet-home .g6-balance{
      display:block;
      font-size:2.2rem;
      margin:8px 0;
    }

    .g6-wallet-note{
      opacity:.72;
      margin:6px 0 18px;
    }

    .g6-fund{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      margin-top:16px;
    }

    .g6-fund input{
      flex:1;
      min-width:180px;
      padding:14px;
      border-radius:12px;
      border:1px solid rgba(255,255,255,.18);
      background:#111;
      color:#fff;
    }

    .g6-fund button{
      padding:14px 18px;
      border:0;
      border-radius:12px;
      font-weight:800;
      cursor:pointer;
    }

    .g6-txs{
      margin-top:18px;
    }

    .g6-tx{
      display:flex;
      justify-content:space-between;
      gap:20px;
      padding:12px 0;
      border-top:1px solid rgba(255,255,255,.1);
    }

    .g6-faqs details{
      padding:16px 0;
      border-top:1px solid rgba(255,255,255,.12);
    }

    .g6-faqs summary{
      cursor:pointer;
      font-weight:700;
    }

    .g6-faqs p{
      opacity:.75;
      line-height:1.6;
    }

    .g6-panel header small{
      display:block;
      opacity:.6;
      margin-top:3px;
    }
  `;
  document.head.append(extra);

  // Separate Wallet + FAQ sections
  const topArea = document.createElement("section");
  topArea.className = "g6-top-area";

  topArea.innerHTML = `
    <section class="g6-wallet-home" id="grim-wallet">
      <small>GRIM WALLET</small>
      <h2>YOUR WALLET</h2>

      <strong class="g6-balance">—</strong>
      <p class="g6-wallet-note">Sign in to view your balance.</p>

      <form class="g6-fund">
        <input
          type="number"
          min="1000"
          max="1000000"
          step="100"
          placeholder="Amount in ₦"
        >
        <button type="submit">FUND WALLET</button>
      </form>

      <div class="g6-txs"></div>
    </section>

    <section class="g6-faq-home" id="grim-faq">
      <small>HELP CENTRE</small>
      <h2>FREQUENTLY ASKED QUESTIONS</h2>
      <div class="g6-faqs">Loading FAQs…</div>
    </section>
  `;

  // Put wallet near the top of the actual storefront
  const main =
    document.querySelector("main") ||
    document.querySelector(".site-main") ||
    document.body;

  if (main === document.body) {
    const header = document.querySelector("header");
    if (header && header.nextSibling) {
      document.body.insertBefore(topArea, header.nextSibling);
    } else {
      document.body.prepend(topArea);
    }
  } else {
    main.prepend(topArea);
  }

  // GRIM Assist is now CHAT ONLY
  const shell = document.createElement("div");

  shell.innerHTML = `
    <button class="g6-fab" aria-label="Open GRIM Assist">G</button>

    <section class="g6-panel" aria-hidden="true">
      <header>
        <div>
          <b>GRIM ASSIST</b>
          <small>Virtual Assistant</small>
        </div>
        <button class="g6-close" aria-label="Close">×</button>
      </header>

      <div class="g6-body">
        <div class="g6-messages">
          <div class="bot">
            RAV’KAEL. How can I help you today?
          </div>
        </div>

        <form class="g6-chat">
          <input
            maxlength="800"
            placeholder="Ask about orders, sizing, delivery…"
            required
          >
          <button type="submit">SEND</button>
        </form>
      </div>
    </section>
  `;

  document.body.append(...shell.children);

  const panel = $(".g6-panel");
  const fab = $(".g6-fab");
  const close = $(".g6-close");
  const messages = $(".g6-messages");

  fab.onclick = () => {
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
  };

  close.onclick = () => {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  };

  // GRIM Assist
  $(".g6-chat").onsubmit = async e => {
    e.preventDefault();

    const input = $(".g6-chat input");
    const msg = input.value.trim();

    if (!msg) return;

    const mine = document.createElement("div");
    mine.className = "me";
    mine.textContent = msg;
    messages.append(mine);

    input.value = "";

    try {
      const b = await api("/api/assist", {
        method: "POST",
        body: JSON.stringify({ message: msg })
      });

      const answer = document.createElement("div");
      answer.className = "bot";
      answer.textContent = b.answer;
      messages.append(answer);

      if (b.escalate) {
        const a = document.createElement("a");
        a.href = "/support.html";
        a.textContent = "Contact GRIM Customer Care →";
        a.className = "g6-support";
        messages.append(a);
      }
    } catch {
      const error = document.createElement("div");
      error.className = "bot";
      error.textContent =
        "GRIM Assist is temporarily unavailable. Please use Customer Care.";
      messages.append(error);
    }

    messages.scrollTop = messages.scrollHeight;
  };

  // FAQ — independent from GRIM Assist
  async function loadFaq() {
    const box = $(".g6-faqs");

    try {
      const rows = await api("/api/faqs");

      box.innerHTML = "";

      if (!rows.length) {
        box.textContent = "No FAQs have been published yet.";
        return;
      }

      rows.forEach(item => {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        const p = document.createElement("p");

        summary.textContent = item.q;
        p.textContent = item.a;

        details.append(summary, p);
        box.append(details);
      });
    } catch {
      box.textContent = "FAQs are temporarily unavailable.";
    }
  }

  // Wallet
  async function loadAccount() {
    try {
      const a = await api("/api/account");

      $(".g6-balance").textContent =
        fmt(a.wallet?.balance || 0);

      $(".g6-wallet-note").textContent =
        `Signed in as ${a.user.email}`;

      const txs = $(".g6-txs");
      txs.innerHTML = "";

      const transactions = (a.transactions || []).slice(0, 8);

      if (!transactions.length) {
        txs.innerHTML = "<p>No wallet transactions yet.</p>";
        return;
      }

      transactions.forEach(t => {
        const row = document.createElement("div");
        row.className = "g6-tx";

        const type = document.createElement("span");
        type.textContent = String(t.type || "").toUpperCase();

        const amount = document.createElement("b");
        amount.textContent =
          `${t.type === "debit" ? "−" : "+"}${fmt(t.amount)}`;

        row.append(type, amount);
        txs.append(row);
      });
    } catch {
      $(".g6-balance").textContent = "—";
      $(".g6-wallet-note").textContent =
        "Sign in to use GRIM Wallet.";
      $(".g6-txs").innerHTML = "";
    }
  }

  $(".g6-fund").onsubmit = async e => {
    e.preventDefault();

    const amount = Number($(".g6-fund input").value);

    try {
      const b = await api("/api/wallet/fund/initialize", {
        method: "POST",
        body: JSON.stringify({ amount })
      });

      location.href = b.authorizationUrl;
    } catch (err) {
      alert(err.message);
    }
  };

  // Wallet Paystack return
  const params = new URLSearchParams(location.search);

  if (
    params.get("wallet") === "verify" &&
    params.get("reference")
  ) {
    api("/api/wallet/fund/verify", {
      method: "POST",
      body: JSON.stringify({
        reference: params.get("reference")
      })
    })
      .then(() => {
        history.replaceState({}, "", location.pathname);
        loadAccount();

        document
          .querySelector("#grim-wallet")
          ?.scrollIntoView({ behavior: "smooth" });
      })
      .catch(e => alert(e.message));
  }

  // Preserve GRIM email 2FA interception
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function(input, init) {
    const response = await originalFetch(input, init);

    try {
      const url =
        typeof input === "string"
          ? input
          : (input?.url || "");

      if (url.includes("/api/login") && response.ok) {
        const clone = response.clone();
        const body = await clone.json();

        if (body?.requiresTwoFactor) {
          setTimeout(
            () => open2FA(body.emailHint),
            0
          );
        }
      }
    } catch {}

    return response;
  };

  function open2FA(hint) {
    let modal = document.querySelector(".g6-2fa");

    if (!modal) {
      modal = document.createElement("div");
      modal.className = "g6-2fa";

      modal.innerHTML = `
        <div class="g6-2fa-card">
          <button class="g6-2fa-x">×</button>

          <small>GRIM SECURITY</small>
          <h2>VERIFY SIGN-IN</h2>

          <p>
            We sent a 6-digit code to
            <b class="g6-2fa-hint"></b>.
          </p>

          <form>
            <input
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              pattern="[0-9]{6}"
              placeholder="000000"
              required
            >
            <button type="submit">VERIFY</button>
          </form>

          <button class="g6-resend">
            RESEND CODE
          </button>

          <p class="g6-2fa-status"></p>
        </div>
      `;

      document.body.append(modal);

      modal.querySelector(".g6-2fa-x").onclick =
        () => modal.remove();

      modal.querySelector("form").onsubmit =
        async e => {
          e.preventDefault();

          const status =
            modal.querySelector(".g6-2fa-status");

          try {
            await api("/api/auth/2fa/verify", {
              method: "POST",
              body: JSON.stringify({
                code: modal.querySelector("input").value
              })
            });

            status.textContent =
              "Verified. Welcome to GRIM.";

            setTimeout(
              () => location.reload(),
              500
            );
          } catch (err) {
            status.textContent = err.message;
          }
        };

      modal.querySelector(".g6-resend").onclick =
        async () => {
          const status =
            modal.querySelector(".g6-2fa-status");

          try {
            await api("/api/auth/2fa/resend", {
              method: "POST",
              body: "{}"
            });

            status.textContent =
              "A new code has been sent.";
          } catch (err) {
            status.textContent = err.message;
          }
        };
    }

    modal.querySelector(".g6-2fa-hint").textContent =
      hint || "your email";
  }

  // Initial storefront data
  loadAccount();
  loadFaq();
})();
/* =========================================================
   GRIM CUSTOMER SETTINGS UI
   ========================================================= */
(() => {
  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    let data = {};
    try {
      data = await response.json();
    } catch {}

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }

    return data;
  };

  const esc = (value = "") =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  function applyTheme(theme) {
    document.documentElement.dataset.grimTheme = theme;

    if (theme === "system") {
      document.documentElement.style.colorScheme = "light dark";
    } else {
      document.documentElement.style.colorScheme = theme;
    }

    localStorage.setItem("grim-theme", theme);
  }

  const savedTheme = localStorage.getItem("grim-theme");
  if (savedTheme) applyTheme(savedTheme);

  const style = document.createElement("style");
  style.textContent = `
    .g6-settings-btn{
      position:fixed;
      right:22px;
      bottom:94px;
      z-index:9997;
      border:1px solid rgba(255,255,255,.18);
      background:#0a0a0a;
      color:#fff;
      border-radius:999px;
      padding:13px 17px;
      font:600 12px/1 Arial,sans-serif;
      letter-spacing:.12em;
      box-shadow:0 14px 40px rgba(0,0,0,.35)
    }

    .g6-settings-overlay{
      position:fixed;
      inset:0;
      z-index:10000;
      background:rgba(0,0,0,.78);
      backdrop-filter:blur(10px);
      display:none;
      overflow:auto;
      padding:18px
    }

    .g6-settings-overlay.open{display:block}

    .g6-settings{
      width:min(720px,100%);
      margin:30px auto;
      background:#090909;
      color:#fff;
      border:1px solid #292929;
      border-radius:24px;
      overflow:hidden;
      box-shadow:0 30px 90px rgba(0,0,0,.55)
    }

    .g6-settings-head{
      display:flex;
      justify-content:space-between;
      align-items:center;
      padding:22px;
      border-bottom:1px solid #242424
    }

    .g6-settings-head h2{
      margin:0;
      font-size:19px;
      letter-spacing:.18em
    }

    .g6-settings-close{
      border:0;
      background:transparent;
      color:#fff;
      font-size:30px
    }

    .g6-settings-body{padding:18px}

    .g6-settings-section{
      border:1px solid #252525;
      border-radius:18px;
      padding:18px;
      margin-bottom:15px;
      background:#111
    }

    .g6-settings-section h3{
      margin:0 0 15px;
      font-size:14px;
      letter-spacing:.12em
    }

    .g6-settings-grid{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:10px
    }

    .g6-settings input,
    .g6-settings select,
    .g6-settings textarea{
      width:100%;
      box-sizing:border-box;
      padding:13px;
      margin:5px 0;
      border:1px solid #333;
      border-radius:12px;
      background:#080808;
      color:#fff;
      font-size:16px
    }

    .g6-settings textarea{
      min-height:90px;
      resize:vertical
    }

    .g6-settings button.g6-save{
      width:100%;
      border:0;
      border-radius:12px;
      padding:13px;
      margin-top:9px;
      background:#fff;
      color:#000;
      font-weight:800
    }

    .g6-row{
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:14px;
      padding:10px 0;
      border-bottom:1px solid #222
    }

    .g6-row:last-child{border-bottom:0}

    .g6-row input[type="checkbox"]{
      width:22px;
      height:22px
    }

    .g6-muted{
      color:#aaa;
      font-size:12px;
      line-height:1.5
    }

    .g6-status{
      min-height:18px;
      margin-top:9px;
      font-size:12px
    }

    .g6-danger{
      border:1px solid #6c2028 !important;
      color:#ffb9c0
    }

    html[data-grim-theme="light"] body{
      background:#f5f5f5 !important;
      color:#111 !important
    }

    @media(max-width:600px){
      .g6-settings-grid{grid-template-columns:1fr}
      .g6-settings{margin:5px auto 90px}
    }
  `;
  document.head.appendChild(style);

  const button = document.createElement("button");
  button.className = "g6-settings-btn";
  button.type = "button";
  button.textContent = "SETTINGS";
  button.hidden = true;
  document.body.appendChild(button);

  const overlay = document.createElement("div");
  overlay.className = "g6-settings-overlay";

  overlay.innerHTML = `
    <div class="g6-settings">
      <div class="g6-settings-head">
        <div>
          <div class="g6-muted">GRIM ACCOUNT</div>
          <h2>SETTINGS</h2>
        </div>
        <button class="g6-settings-close" type="button">×</button>
      </div>

      <div class="g6-settings-body">

        <section class="g6-settings-section">
          <h3>PROFILE</h3>

          <div class="g6-settings-grid">
            <input id="g6-first" placeholder="First name">
            <input id="g6-last" placeholder="Last name">
          </div>

          <input id="g6-email" type="email" placeholder="Email" disabled>
          <input id="g6-phone" type="tel" placeholder="Phone number">
          <input id="g6-birthday" type="date" placeholder="Birthday">

          <select id="g6-size">
            <option value="">Preferred size</option>
            <option>XS</option>
            <option>S</option>
            <option>M</option>
            <option>L</option>
            <option>XL</option>
            <option>XXL</option>
          </select>

          <textarea id="g6-address"
            placeholder="Default shipping address"></textarea>

          <button class="g6-save" id="g6-save-profile">
            SAVE PROFILE
          </button>

          <div class="g6-status" id="g6-profile-status"></div>
        </section>

        <section class="g6-settings-section">
          <h3>SECURITY</h3>

          <div class="g6-row">
            <div>
              <strong>Two-Factor Authentication</strong>
              <div class="g6-muted">
                Require an additional verification code after your password.
              </div>
            </div>

            <input id="g6-2fa" type="checkbox">
          </div>

          <div class="g6-muted" id="g6-security-info"></div>
          <div class="g6-status" id="g6-2fa-status"></div>
        </section>

        <section class="g6-settings-section">
          <h3>CHANGE PASSWORD</h3>

          <input id="g6-current-password"
            type="password"
            autocomplete="current-password"
            placeholder="Current password">

          <input id="g6-new-password"
            type="password"
            autocomplete="new-password"
            placeholder="New password">

          <input id="g6-confirm-password"
            type="password"
            autocomplete="new-password"
            placeholder="Confirm new password">

          <button class="g6-save" id="g6-change-password">
            CHANGE PASSWORD
          </button>

          <div class="g6-status" id="g6-password-status"></div>
        </section>

        <section class="g6-settings-section">
          <h3>APPEARANCE</h3>

          <select id="g6-theme">
            <option value="system">Use phone/system appearance</option>
            <option value="dark">Dark mode</option>
            <option value="light">Light mode</option>
          </select>

          <button class="g6-save" id="g6-save-theme">
            SAVE APPEARANCE
          </button>

          <div class="g6-status" id="g6-theme-status"></div>
        </section>

        <section class="g6-settings-section">
          <h3>SHOPPING</h3>

          <input id="g6-colorways"
            placeholder="Preferred colorways — e.g. Obsidian, Veil">

          <textarea id="g6-checkout"
            placeholder="Checkout preferences / delivery notes"></textarea>

          <div class="g6-status" id="g6-shopping-status"></div>
        </section>

        <section class="g6-settings-section">
          <h3>NOTIFICATIONS</h3>

          <label class="g6-row">
            <span>Order updates</span>
            <input id="g6-notify-orders" type="checkbox">
          </label>

          <label class="g6-row">
            <span>Wallet activity</span>
            <input id="g6-notify-wallet" type="checkbox">
          </label>

          <label class="g6-row">
            <span>New GRIM drops</span>
            <input id="g6-notify-drops" type="checkbox">
          </label>

          <label class="g6-row">
            <span>Restocks</span>
            <input id="g6-notify-restocks" type="checkbox">
          </label>

          <label class="g6-row">
            <span>Promotions</span>
            <input id="g6-notify-promotions" type="checkbox">
          </label>

          <label class="g6-row">
            <span>House of GRIM</span>
            <input id="g6-notify-house" type="checkbox">
          </label>

          <div class="g6-status" id="g6-notification-status"></div>
        </section>

        <section class="g6-settings-section">
          <h3>PRIVACY & ACCOUNT</h3>

          <label class="g6-row">
            <div>
              <strong>Marketing emails</strong>
              <div class="g6-muted">
                Receive GRIM marketing and promotional communication.
              </div>
            </div>
            <input id="g6-marketing" type="checkbox">
          </label>

          <div class="g6-row">
            <span>Account status</span>
            <strong id="g6-account-status">ACTIVE</strong>
          </div>

          <div class="g6-muted">
            Account deletion/deactivation should require confirmation
            before any permanent action.
          </div>
        </section>

      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const $ = selector => overlay.querySelector(selector);

  async function loadSettings() {
    try {
      const data = await api("/api/settings");

      button.hidden = false;

      const p = data.profile || {};
      const s = data.security || {};
      const n = data.notifications || {};
      const privacy = data.privacy || {};
      const shopping = data.shopping || {};

      $("#g6-first").value = p.firstName || "";
      $("#g6-last").value = p.lastName || "";
      $("#g6-email").value = p.email || "";
      $("#g6-phone").value = p.phone || "";
      $("#g6-birthday").value = p.birthday || "";
      $("#g6-size").value = p.preferredSize || "";
      $("#g6-address").value = p.shippingAddress || "";

      $("#g6-2fa").checked = s.twoFactorEnabled === true;

      $("#g6-theme").value = data.appearance || "system";

      $("#g6-colorways").value =
        Array.isArray(shopping.preferredColorways)
          ? shopping.preferredColorways.join(", ")
          : (shopping.preferredColorways || "");

      $("#g6-checkout").value =
        typeof shopping.checkoutPreferences === "string"
          ? shopping.checkoutPreferences
          : "";

      $("#g6-notify-orders").checked = n.orders !== false;
      $("#g6-notify-wallet").checked = n.wallet !== false;
      $("#g6-notify-drops").checked = n.drops !== false;
      $("#g6-notify-restocks").checked = n.restocks !== false;
      $("#g6-notify-promotions").checked = n.promotions === true;
      $("#g6-notify-house").checked = n.houseOfGrim !== false;

      $("#g6-marketing").checked =
        privacy.marketingConsent === true;

      $("#g6-account-status").textContent =
        String(privacy.accountStatus || "active").toUpperCase();

      const securityBits = [];

      if (s.googleConnected) securityBits.push("Google connected");
      if (s.lastLoginAt) securityBits.push("Last login recorded");
      if (s.passwordChangedAt) securityBits.push("Password history active");

      $("#g6-security-info").textContent =
        securityBits.join(" • ");

      applyTheme(data.appearance || "system");

    } catch {
      button.hidden = true;
    }
  }

  button.onclick = async () => {
    overlay.classList.add("open");
    await loadSettings();
  };

  $(".g6-settings-close").onclick = () =>
    overlay.classList.remove("open");

  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.classList.remove("open");
  });

  $("#g6-save-profile").onclick = async () => {
    const status = $("#g6-profile-status");

    try {
      status.textContent = "Saving…";

      await api("/api/settings/profile", {
        method: "POST",
        body: JSON.stringify({
          firstName: $("#g6-first").value.trim(),
          lastName: $("#g6-last").value.trim(),
          phone: $("#g6-phone").value.trim(),
          birthday: $("#g6-birthday").value || null,
          preferredSize: $("#g6-size").value,
          shippingAddress: $("#g6-address").value.trim()
        })
      });

      status.textContent = "Profile saved.";
    } catch (err) {
      status.textContent = err.message;
    }
  };

  $("#g6-2fa").onchange = async e => {
    const status = $("#g6-2fa-status");

    try {
      status.textContent = "Saving…";

      await api("/api/settings/2fa", {
        method: "POST",
        body: JSON.stringify({
          enabled: e.target.checked
        })
      });

      status.textContent =
        e.target.checked
          ? "2FA enabled."
          : "2FA disabled.";

    } catch (err) {
      e.target.checked = !e.target.checked;
      status.textContent = err.message;
    }
  };

  $("#g6-change-password").onclick = async () => {
    const status = $("#g6-password-status");
    const currentPassword = $("#g6-current-password").value;
    const newPassword = $("#g6-new-password").value;
    const confirm = $("#g6-confirm-password").value;

    if (!currentPassword) {
      status.textContent = "Enter your current password.";
      return;
    }

    if (newPassword.length < 8) {
      status.textContent =
        "New password must contain at least 8 characters.";
      return;
    }

    if (newPassword !== confirm) {
      status.textContent = "New passwords do not match.";
      return;
    }

    try {
      status.textContent = "Changing password…";

      await api("/api/settings/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });

      $("#g6-current-password").value = "";
      $("#g6-new-password").value = "";
      $("#g6-confirm-password").value = "";

      status.textContent = "Password changed.";
    } catch (err) {
      status.textContent = err.message;
    }
  };

  $("#g6-save-theme").onclick = async () => {
    const theme = $("#g6-theme").value;
    const status = $("#g6-theme-status");

    try {
      status.textContent = "Saving…";

      await api("/api/settings/appearance", {
        method: "POST",
        body: JSON.stringify({ theme })
      });

      applyTheme(theme);
      status.textContent = "Appearance saved.";
    } catch (err) {
      status.textContent = err.message;
    }
  };

  loadSettings();
})();

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

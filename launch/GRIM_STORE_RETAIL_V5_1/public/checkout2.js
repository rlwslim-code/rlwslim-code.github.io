/* Built on the existing Checkout 2.0 UI: account, cart, billing, wallet and recovery. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    form = $("checkoutForm"),
    fields = form.elements;
  let customer = null,
    quote = null,
    pending = null,
    busy = false,
    addresses = [], mode = "test", walletEnabled = true,
    acceptingOrders = true, shippingRequired = false, shippingToken = null, shippingOffers = null;
  const fmt = (n) =>
    new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
    }).format(n / 100);
  const say = (text, error = false) => {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
  };
  const storage = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
        return true;
      } catch {return false;}
    },
    remove: (k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    },
  };
  let cart = [];
  try {
    const c = JSON.parse(localStorage.getItem("grimCart") || "[]");
    if (Array.isArray(c)) cart = c;
  } catch {}
  const lines = () =>
    cart.map((i) => ({
      productId: String(i.id),
      quantity: Number(i.qty),
      size: String(i.size || "M"),
    }));
  const ownerKey = () => `grim2_checkout_key:${customer.id}`;
  function requestKey() {
    let k = storage.get(ownerKey());
    if (!k) {
      k = crypto.randomUUID();
      if(!storage.set(ownerKey(), k))throw Error('Browser storage is unavailable. Enable it so your payment can be safely recovered.');
    }
    return k;
  }
  function lock(value) {
    busy = value;
    document.querySelectorAll("button").forEach((b) => {
      b.disabled = value;
    });
    $("payButton").disabled = value || !acceptingOrders || !!pending || !quote || (shippingRequired && !shippingToken);
  }
  async function api(path, data) {
    const r = await fetch(`/api/checkout2/${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      ...(data
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          }
        : {}),
    });
    const v = await r
      .json()
      .catch(() => ({ message: "Checkout service unavailable." }));
    if (!r.ok) {
      const e = new Error(v.message || v.error || "Request failed.");
      e.status = r.status;
      e.code = v.error;
      throw e;
    }
    return v;
  }
  function drawQuote(q) {
    quote = q;
    $("items").replaceChildren();
    for (const i of q.items) {
      const d = document.createElement("div");
      d.className = "item";
      d.textContent = `${i.name} · ${fmt(i.lineKobo)}`;
      const s = document.createElement("small");
      s.textContent = `${i.color} / ${i.size} / Quantity ${i.quantity}`;
      d.append(s);
      $("items").append(d);
    }
    $("subtotal").textContent = fmt(q.subtotalKobo);
    $("delivery").textContent = shippingRequired && !shippingToken ? 'Choose a courier' : fmt(q.shippingKobo);
    $("total").textContent = fmt(q.totalKobo);
  }
  // Live shipping is never free by default: only a server-issued courier quote can authorize payment.
  function shippingControls() {
    let block = $('grim2ShippingChooser');
    if (block) return block;
    block = document.createElement('section');
    block.id = 'grim2ShippingChooser';
    const title = document.createElement('h3'); title.textContent = 'CHOOSE YOUR DELIVERY COURIER';
    const btn = document.createElement('button'); btn.type = 'button'; btn.id='grim2FetchCouriers';
    btn.textContent='FIND AVAILABLE COURIERS';
    const offers = document.createElement('div'); offers.id = 'grim2CourierOffers';
    block.append(title,btn,offers);
    $('payButton').parentElement.before(block);
    btn.addEventListener('click', async()=>{
      if (busy || !customer || !quote) return;
    if(!acceptingOrders) {say("New payments are paused. Check an existing card payment to recover it.",true);return;}
      shippingToken=null; shippingOffers=null; lock(true); offers.textContent='Checking delivery options…';
      try {
        const r = await api('shipping/quotes',{lines:lines(),destination:read('shipping'),contact:{firstName:fields.firstName.value,lastName:fields.lastName.value,phone:fields.phone.value}});
        shippingOffers=r; offers.replaceChildren();
        for (const c of r.couriers || []) {
          const label=document.createElement('label');label.className='choice courier-choice';
          const radio=document.createElement('input');radio.type='radio';radio.name='grim2Courier';
          radio.value=c.selectionToken;
          label.append(radio, document.createTextNode(` ${c.name} · ${fmt(c.amountKobo)}${c.eta ? ' · '+c.eta : ''}`));
          radio.addEventListener('change',()=>{
            shippingToken=c.selectionToken;
            drawQuote({...quote,shippingKobo:c.amountKobo,totalKobo:quote.subtotalKobo+c.amountKobo});
            lock(false);
          });
          offers.append(label,document.createElement('br'));
        }
        if (!r.couriers?.length) throw Error('No delivery couriers are available for this address.');
      } catch(e) { offers.textContent=e.message || 'Delivery quotations unavailable.';say(offers.textContent,true); }
      finally {lock(false);}
    });
    for (const field of form.querySelectorAll('[name^="shipping"], [name="firstName"], [name="lastName"], [name="phone"]')) {
      field.addEventListener('change',()=>{
        shippingToken=null; shippingOffers=null;
        offers.textContent='Delivery address changed. Refresh courier options.';
        if(quote)drawQuote({...quote,shippingKobo:0,totalKobo:quote.subtotalKobo});
        lock(false);
      });
    }
    return block;
  }
  function fill(prefix, address) {
    if (!address || typeof address !== "object") return;
    for (const k of [
      "country",
      "address",
      "apartment",
      "city",
      "state",
      "postal",
    ]) {
      const input = fields[`${prefix}${k[0].toUpperCase() + k.slice(1)}`];
      if (input) input.value = address[k] || "";
    }
  }
  function read(prefix) {
    return Object.fromEntries(
      ["country", "address", "apartment", "city", "state", "postal"].map(
        (k) => [
          k,
          fields[`${prefix}${k[0].toUpperCase() + k.slice(1)}`].value.trim(),
        ],
      ),
    );
  }
  function addressOptions() {
    for (const id of ["savedShipping", "savedBilling"]) {
      const s = $(id);
      s.replaceChildren(new Option("Enter a new address", ""));
      addresses.forEach((a, i) =>
        s.add(
          new Option(
            [a.address, a.city, a.country].filter(Boolean).join(", "),
            String(i),
          ),
        ),
      );
    }
  }
  function paid(result) {
    const details=result.quote || {};
    const evidence=result.receipt;
    $('receipt').hidden=false;
    $('receiptDetails').textContent=[`Order: ${result.orderId || result.reference}`,`Reference: ${result.reference}`,
      ...(details.items||[]).map(i=>`${i.name} / ${i.size} × ${i.quantity}: ${fmt(i.lineKobo)}`),
      `Subtotal: ${fmt(details.subtotalKobo || 0)}`,`Delivery: ${fmt(details.shippingKobo || 0)}${details.courier?.name ? ' / '+details.courier.name : ''}`,
      `Order total: ${fmt(details.totalKobo || 0)}`,`Payment: ${result.method==='wallet'?'GRIM Wallet':'Paystack card'}`,
      ...(evidence ? [`Card processing fee: ${fmt(evidence.processingFeeKobo || 0)}`,`Charged: ${fmt(evidence.chargedAmountKobo)}`] : [])].join('\n');
    $('printReceipt').onclick=()=>window.print();
    pending = null;
    storage.remove(ownerKey());
    $("recovery").hidden = true;
    $("checkoutLayout").hidden = true;
    say(
      `${mode === "test" ? "Test payment" : "Payment"} confirmed. Order recorded.\nReference: ${result.reference}`,
    );
    try {
      const completedKey=`grim2_cart_completed:${customer.id}:${result.reference}`;
      if(storage.get(completedKey)) return;
      const current = JSON.parse(localStorage.getItem("grimCart") || "[]");
      const bought = result.quote?.items || [];
      const left = current
        .map((i) => {
          const match = bought.find(
            (x) =>
              String(i.id) === x.productId && String(i.size || "M") === x.size,
          );
          return { ...i, qty: Number(i.qty) - (match?.quantity || 0) };
        })
        .filter((i) => i.qty > 0);
      localStorage.setItem("grimCart", JSON.stringify(left));
      storage.set(completedKey,"true");
    } catch {}
  }
  function recovery(result) {
    pending = result;
    $("recovery").hidden = false;
    $("pending").replaceChildren();
    const d = document.createElement("div");
    d.className = "pending-item";
    d.textContent = `${result.reference} · ${result.status}`;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "CHECK EXISTING PAYMENT";
    b.onclick = () => check(result.reference);
    d.append(b);
    if (result.authorizationUrl) {
      try {
        const u = new URL(result.authorizationUrl);
        if (u.protocol === "https:" && u.hostname === "checkout.paystack.com") {
          const resume = document.createElement("button");
          resume.type = "button";
          resume.textContent = mode === "test" ? "RESUME THIS TEST PAYMENT" : "RESUME THIS PAYMENT";
          resume.onclick = () => location.assign(u.href);
          d.append(resume);
        }
      } catch {}
    }
    if (result.method === "wallet") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "RETRY EXISTING WALLET CHECKOUT";
      retry.onclick = () => submit();
      d.append(retry);
    }
    if(result.method==='wallet' && result.status!=='paid') {
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='CHOOSE DELIVERY AGAIN';
      cancel.onclick=async()=>{try{const r=await api('wallet/cancel',{reference:result.reference});if(r.status==='paid')return paid(r);pending=null;storage.remove(ownerKey());shippingToken=null;$('recovery').hidden=true;await load();}catch(e){say(e.message,true);}};
      d.append(cancel);
    }
    $("pending").append(d);
    if (result.quote) drawQuote(result.quote);
    $("payButton").disabled = true;
  }
  async function check(reference) {
    if (busy) return;
    lock(true);
    say("Checking the existing payment. Please do not pay again.");
    try {
      const result = await api("confirm", { reference });
      if (result.status === "paid") paid(result);
      else {
        recovery(result);
        say(
          result.message ||
            `Payment status: ${result.providerStatus || result.status}. Resume or check the same reference.`,
        );
      }
    } catch (e) {
      say(
        `${e.message}\nKeep reference: ${reference}. Do not start another payment.`,
        true,
      );
    } finally {
      lock(false);
    }
  }
  async function load() {
    try {
      const account = await api("account");
      customer = account.customer;
      $("signin").hidden = true;
      $("checkoutLayout").hidden = false;
      $("accountEmail").textContent = customer.email;
      const parts = String(customer.name || "").split(/\s+/);
      fields.firstName.value = customer.firstName || parts.shift() || "";
      fields.lastName.value = customer.lastName || parts.join(" ");
      fields.phone.value = customer.phone || "";
      addresses = [...(account.addresses || [])];
      if (account.savedBilling) addresses.push(account.savedBilling);
      addressOptions();
      fill("shipping", account.shippingAddress);
      const w = account.wallet;
      $("walletBalance").textContent =
        `${fmt(w.balanceKobo)} available${mode === "test" ? " · test balance" : ""}`;
      $("walletMethod").disabled = !w.active || !walletEnabled;
      const ref = new URLSearchParams(location.search).get("reference");
      pending =
        (account.pending || []).find((p) => p.reference === ref) ||
        (account.pending || [])[0] ||
        null;
      if (pending) {
        recovery(pending);
        say(
          "An unfinished checkout was found. Recover it before paying again.",
        );
      } else if (ref) {
        lock(false);
        await check(ref);
        return;
      } else if (cart.length) {
        drawQuote(await api("quote", { lines: lines() }));
        say("Review your delivery and billing details.");
      } else {
        say("Your bag is empty. Add a piece from the shop to continue.");
        $("checkoutLayout").hidden = true;
      }
      lock(false);
    } catch (e) {
      if (e.status === 401) {
        $("signin").hidden = false;
        $("checkoutLayout").hidden = true;
        say("Sign in to continue securely.");
      } else say(e.message, true);
    }
  }
  async function submit() {
    if (busy || !customer || !quote) return;
    if(!acceptingOrders) {say("New payments are paused. Check an existing card payment to recover it.",true);return;}
    if (pending?.method !== "wallet" && pending) {
      say("Check the existing payment before continuing.", true);
      return;
    }
    lock(true);
    say(mode === "test" ? "Preparing your test payment…" : "Preparing your payment…");
    try {
      const shipping = read("shipping"),
        billing = $("billingSame").checked ? shipping : read("billing");
      if ($("saveBilling").checked && !pending)
        await api("addresses", { address: billing });
      const result = await api("start", {
        key: requestKey(),
        expectedTotalKobo: quote.totalKobo,
        shippingSelectionToken: shippingToken,
        method: pending?.method || fields.method.value,
        lines: lines(),
        shipping,
        billing,
        contact: {
          firstName: fields.firstName.value.trim(),
          lastName: fields.lastName.value.trim(),
          phone: fields.phone.value.trim(),
        },
      });
      if (result.status === "paid") paid(result);
      else {
        recovery(result);
        if (result.authorizationUrl) {
          const u = new URL(result.authorizationUrl);
          if (u.protocol !== "https:" || u.hostname !== "checkout.paystack.com")
            throw Error("Invalid payment destination.");
          location.assign(u.href);
        } else
          say(
            result.message ||
              "Your checkout is pending. Check this reference before paying again.",
          );
      }
    } catch (e) {
      say(e.message, true);
      try {
        if(e.code==='PRICE_CHANGED')drawQuote(await api('quote',{lines:lines()}));
        const a = await api("account");
        if (a.pending?.length) recovery(a.pending[0]);
      } catch {}
    } finally {
      lock(false);
    }
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    submit();
  };
  $("billingSame").onchange = () => {
    $("billingFields").hidden = $("billingSame").checked;
    for (const n of ["Address", "City", "State"])
      fields[`billing${n}`].required = !$("billingSame").checked;
  };
  $("savedShipping").onchange = (e) => {
    fill("shipping", addresses[e.target.value]);
    fields.shippingAddress.dispatchEvent(new Event('change'));
  };
  $("savedBilling").onchange = (e) =>
    fill("billing", addresses[e.target.value]);
  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    lock(true);
    try {
      const data = Object.fromEntries(new FormData(e.target));
      const r = await fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const b = await r.json();
      fields.firstName.value = "";
      e.target.elements.password.value = "";
      if (!r.ok) throw Error(b.error || "Sign-in failed.");
      if (b.requiresTwoFactor) {
        e.target.hidden = true;
        $("codeForm").hidden = false;
        say("Enter the six-digit code sent to your email.");
      } else await load();
    } catch (e) {
      say(e.message, true);
    } finally {
      lock(false);
    }
  };
  $("codeForm").onsubmit = async (e) => {
    e.preventDefault();
    lock(true);
    try {
      const r = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: e.target.elements.code.value }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error || "Verification failed.");
      e.target.elements.code.value = "";
      await load();
    } catch (e) {
      say(e.message, true);
    } finally {
      lock(false);
    }
  };
  api("config")
    .then((c) => {
      if (!c.enabled || !c.ready) {
        say(
          (c.shippingRequired && !c.shippingAvailable ? 'Shipping is not configured; live checkout is safely disabled.' : c.blockers?.join("\n")) ||
            "Checkout 2.0 is available only on Preview.",
          true,
        );
        lock(true);
        return;
      }
      mode = c.mode === "live" ? "live" : "test";
      walletEnabled = c.walletEnabled !== false;
      shippingRequired = c.shippingRequired === true;
      acceptingOrders = c.acceptingOrders !== false;
      if (shippingRequired) shippingControls();
      document.querySelector(".intro .eyebrow").textContent =
        mode === "test" ? "GRIM CHECKOUT 2.0 · TEST PREVIEW" : "GRIM SECURE CHECKOUT";
      document.querySelector(".intro p:last-child").textContent =
        mode === "test" ? "Test payments only. Enter test card details on Paystack's secure page." :
        "Complete your payment securely on Paystack. Any Paystack card processing fee will be shown before you authorize the charge.";
      document.querySelector("#signin p").textContent = mode === "test" ?
        "Use an account created in the test environment." : "Sign in with your GRIM account.";
      document.querySelector("#saveBilling").parentElement.lastChild.textContent =
        "Save this billing address to my GRIM account";
      document.querySelector('input[name="method"][value="card"]').parentElement.querySelector("span").firstChild.textContent =
        mode === "test" ? "PAYSTACK TEST CARD" : "PAYSTACK CARD";
      document.querySelector("#walletMethod").parentElement.querySelector("span").firstChild.textContent =
        mode === "test" ? "GRIM TEST WALLET" : "GRIM WALLET";
      document.querySelector("#payButton").textContent = mode === "test" ?
        "CONTINUE TO TEST PAYMENT" : "CONTINUE TO PAYMENT";
      document.querySelector("#checkoutForm .note").textContent = mode === "test" ?
        "All totals settle in NGN. This Preview uses test wallet balances." :
        "All totals settle in NGN. Wallet checkout deducts only the displayed order total.";
      load();
    })
    .catch((e) => say(e.message, true));
})();

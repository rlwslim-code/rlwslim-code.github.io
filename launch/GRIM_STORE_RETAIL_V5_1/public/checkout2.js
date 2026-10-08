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
    addresses = [];
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
    $("payButton").disabled = value || !!pending || !quote;
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
    $("delivery").textContent = fmt(q.shippingKobo);
    $("total").textContent = fmt(q.totalKobo);
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
    pending = null;
    storage.remove(ownerKey());
    $("recovery").hidden = true;
    $("checkoutLayout").hidden = true;
    say(
      `Test payment confirmed. Order recorded.\nReference: ${result.reference}`,
    );
    try {
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
          resume.textContent = "RESUME THIS TEST PAYMENT";
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
        `${fmt(w.balanceKobo)} available · test balance`;
      $("walletMethod").disabled = !w.active;
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
    if (pending?.method !== "wallet" && pending) {
      say("Check the existing payment before continuing.", true);
      return;
    }
    lock(true);
    say("Preparing your test payment…");
    try {
      const shipping = read("shipping"),
        billing = $("billingSame").checked ? shipping : read("billing");
      if ($("saveBilling").checked && !pending)
        await api("addresses", { address: billing });
      const result = await api("start", {
        key: requestKey(),
        expectedTotalKobo: quote.totalKobo,
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
  $("savedShipping").onchange = (e) =>
    fill("shipping", addresses[e.target.value]);
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
          c.blockers?.join("\n") ||
            "Checkout 2.0 is available only on Preview.",
          true,
        );
        lock(true);
        return;
      }
      load();
    })
    .catch((e) => say(e.message, true));
})();

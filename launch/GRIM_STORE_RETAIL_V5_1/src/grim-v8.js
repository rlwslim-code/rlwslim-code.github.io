// GRIM V8 — wallet + persistent customer care API foundation.
// Requires the V8 Supabase migration already installed.

export function installGrimV8(app, { supabase, priceCart, notifyOrder }) {
  const clean = (v, n = 500) => String(v ?? "").trim().slice(0, n);
  const cleanEmail = v => clean(v, 200).toLowerCase();

  function dbReady(res) {
    if (supabase) return true;
    res.status(503).json({ error: "GRIM account services are unavailable." });
    return false;
  }

  function sessionUser(req, res) {
    const user = req.session?.user;
    if (!user?.email) {
      res.status(401).json({ error: "Sign in to continue." });
      return null;
    }
    return user;
  }

  async function customerFor(req, res) {
    const session = sessionUser(req, res);
    if (!session) return null;
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,first_name,last_name,email,phone")
      .eq("email", cleanEmail(session.email))
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: "GRIM customer account was not found." });
      return null;
    }
    return data;
  }

  // Currency-aware wallet account view. No browser-side balance mutation.
  app.get("/api/v8/wallet", async (req, res) => {
    if (!dbReady(res)) return;
    try {
      const customer = await customerFor(req, res);
      if (!customer) return;

      const { data: accounts, error: aErr } = await supabase
        .from("wallet_accounts")
        .select("id,currency,balance_minor,status,updated_at")
        .eq("customer_id", customer.id)
        .order("currency", { ascending: true });
      if (aErr) throw aErr;

      const { data: transactions, error: tErr } = await supabase
        .from("wallet_transactions")
        .select("id,currency,amount_minor,transaction_type,source,order_id,payment_reference,description,balance_before_minor,balance_after_minor,status,created_at")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (tErr) throw tErr;

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        ok: true,
        accounts: accounts || [],
        transactions: transactions || []
      });
    } catch (e) {
      console.error("[GRIM V8 wallet]", e);
      return res.status(500).json({ error: "Unable to load GRIM Wallet." });
    }
  });


  // Secure GRIM Wallet checkout.
  // Product prices are recalculated by server.js; the browser never supplies the payable total.
  app.post("/api/v8/wallet/checkout", async (req, res) => {
    if (!dbReady(res)) return;

    let pendingOrderId = null;

    try {
      const customer = await customerFor(req, res);
      if (!customer) return;

      if (typeof priceCart !== "function") {
        return res.status(503).json({ error: "Wallet checkout is temporarily unavailable." });
      }

      const name = clean(req.body?.name || customer.name || "", 160);
      const email = cleanEmail(customer.email);
      const phone = clean(req.body?.phone || customer.phone || "", 80);
      const address = clean(req.body?.address, 500);
      const country = clean(req.body?.country || "NG", 2).toUpperCase();
      const currency = clean(req.body?.currency || "NGN", 3).toUpperCase();
      const checkoutKey = clean(req.body?.checkoutKey, 100);

      if (!name || !email || !phone || !address || !Array.isArray(req.body?.items) || !req.body.items.length) {
        return res.status(400).json({ error: "Complete checkout details." });
      }

      // Current GRIM catalog prices are authoritative NGN prices.
      // Other wallet currencies stay isolated until server-side FX/catalog pricing is added.
      if (currency !== "NGN") {
        return res.status(400).json({ error: "Wallet checkout currently supports NGN orders only." });
      }

      if (!/^[A-Za-z0-9_-]{12,100}$/.test(checkoutKey)) {
        return res.status(400).json({ error: "Invalid checkout request. Refresh checkout and try again." });
      }

      const idempotencyKey = `wallet-order:${customer.id}:${checkoutKey}`;

      // Safe retry: if this checkout key already debited the wallet, return that order.
      const { data: existing, error: existingErr } = await supabase
        .from("wallet_transactions")
        .select("order_id,currency,amount_minor,status")
        .eq("customer_id", customer.id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingErr) throw existingErr;

      if (existing?.order_id) {
        return res.json({
          ok: true,
          paid: true,
          duplicate: true,
          orderId: existing.order_id,
          currency: existing.currency,
          total: Number(existing.amount_minor || 0) / 100
        });
      }

      const priced = await priceCart(req.body.items);
      const cleanItems = Array.isArray(priced?.items) ? priced.items : [];
      const total = Number(priced?.total || 0);

      if (!cleanItems.length || !Number.isFinite(total) || total <= 0) {
        return res.status(400).json({ error: "Your cart has no available products." });
      }

      // Existing GRIM product prices are major NGN units; wallet ledger stores minor units.
      const amountMinor = Math.round(total * 100);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        return res.status(400).json({ error: "Unable to calculate this order total." });
      }

      // Create a pending Supabase order first so the wallet debit has a durable order reference.
      const orderPayload = {
        name,
        email,
        phone,
        address,
        total,
        status: "payment_pending",
        items: cleanItems,
        country: country || "NG",
        currency: "NGN"
      };

      const { data: pendingOrder, error: orderErr } = await supabase
        .from("orders")
        .insert(orderPayload)
        .select("id")
        .single();
      if (orderErr) throw orderErr;

      pendingOrderId = String(pendingOrder.id);

      const { data: debitResult, error: debitErr } = await supabase.rpc("grim_wallet_debit", {
        p_customer_id: customer.id,
        p_currency: "NGN",
        p_amount_minor: amountMinor,
        p_order_id: pendingOrderId,
        p_description: `GRIM order #${pendingOrderId}`,
        p_idempotency_key: idempotencyKey
      });

      if (debitErr) {
        // No wallet debit occurred if the RPC failed; remove the pending order.
        await supabase.from("orders").delete().eq("id", pendingOrder.id).eq("status", "payment_pending");

        const msg = String(debitErr.message || "").toLowerCase();
        if (msg.includes("insufficient")) {
          return res.status(409).json({ error: "Insufficient GRIM Wallet balance." });
        }
        if (msg.includes("frozen") || msg.includes("active")) {
          return res.status(409).json({ error: "This GRIM Wallet cannot be used right now." });
        }
        throw debitErr;
      }

      // Debit succeeded. Mark the durable order ready for normal admin fulfilment.
      const { error: paidErr } = await supabase
        .from("orders")
        .update({ status: "new" })
        .eq("id", pendingOrder.id);
      if (paidErr) {
        console.error("[GRIM V8 wallet checkout order finalize]", paidErr);
      }

      const order = {
        id: pendingOrder.id,
        name,
        email,
        phone,
        address,
        items: cleanItems,
        total
      };

      if (typeof notifyOrder === "function") {
        try {
          await notifyOrder(order);
        } catch (mailErr) {
          console.error("[GRIM V8 wallet checkout email]", mailErr);
        }
      }

      return res.status(201).json({
        ok: true,
        paid: true,
        paymentMethod: "wallet",
        orderId: pendingOrder.id,
        total,
        currency: "NGN",
        debit: debitResult ?? null
      });
    } catch (e) {
      console.error("[GRIM V8 wallet checkout]", e);
      return res.status(500).json({ error: "Unable to complete wallet checkout right now." });
    }
  });

app.post("/api/v8/wallet/fund/initialize", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!dbReady(res)) return;
    try {
      const customer = await customerFor(req, res);
      if (!customer) return;

      const amountMinor = Number(req.body?.amountMinor);
      const currency = clean(req.body?.currency || "NGN", 3).toUpperCase();

      if (currency !== "NGN") {
        return res.status(400).json({ error: "Wallet funding currently supports NGN only." });
      }
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 10000 || amountMinor > 1000000000) {
        return res.status(400).json({ error: "Enter an amount between ₦100 and ₦10,000,000." });
      }

      const key = paystackSecret();
      const { randomBytes } = await import("node:crypto");
      const reference = `GRIM-WALLET-${randomBytes(16).toString("hex")}`;
      const origin = "https://rlwslim-code-github-io.vercel.app";

      const tx = await paystackRequest("initialize", key, {
        email: customer.email,
        amount: amountMinor,
        currency: "NGN",
        reference,
        callback_url: `${origin}/?grim-wallet=return&reference=${encodeURIComponent(reference)}`,
        metadata: {
          grim_wallet: {
            version: 1,
            customer_id: customer.id,
            email: customer.email,
            amount_minor: amountMinor,
            currency: "NGN",
            reference
          },
          cancel_action: `${origin}/?grim-wallet=cancel`
        }
      });

      let checkout = null;
      try {
        const u = new URL(tx.authorization_url);
        if (u.origin === "https://checkout.paystack.com") checkout = u.href;
      } catch {}
      if (tx.reference !== reference || !checkout) {
        throw new Error("Paystack returned an invalid wallet checkout response.");
      }

      return res.json({
        ok: true,
        reference,
        amountMinor,
        currency: "NGN",
        authorizationUrl: checkout
      });
    } catch (e) {
      console.error("[GRIM V8 wallet fund initialize]", e);
      return res.status(e.statusCode || 500).json({ error: e.message || "Unable to start wallet funding." });
    }
  });

  app.post("/api/v8/wallet/fund/verify", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!dbReady(res)) return;
    try {
      const reference = clean(req.body?.reference, 80);
      if (!walletRefPattern.test(reference)) {
        return res.status(400).json({ error: "Invalid wallet payment reference." });
      }

      const key = paystackSecret();
      const tx = await paystackRequest(`verify/${encodeURIComponent(reference)}`, key);
      let metadata = tx.metadata || {};
      if (typeof metadata === "string") {
        try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
      }
      const w = metadata.grim_wallet || {};
      const amountMinor = Number(w.amount_minor);

      const session = sessionUser(req, res);
      if (!session) return;
      if (!w.email || cleanEmail(w.email) !== cleanEmail(session.email)) {
        return res.status(403).json({ error: "Sign in with the GRIM account that made this wallet payment." });
      }
      const { data: customer, error: customerErr } = await supabase
        .from("customers").select("id,email").eq("email", cleanEmail(session.email)).maybeSingle();
      if (customerErr) throw customerErr;
      if (!customer) return res.status(404).json({ error: "GRIM customer account was not found." });

      const verified =
        tx.status === "success" &&
        tx.reference === reference &&
        w.reference === reference &&
        Number(w.version) === 1 &&
        String(w.customer_id) === String(customer.id) &&
        cleanEmail(w.email) === cleanEmail(customer.email) &&
        Number.isSafeInteger(amountMinor) &&
        amountMinor > 0 &&
        Number.isSafeInteger(Number(tx.amount)) &&
        Number(tx.amount) >= amountMinor &&
        Number(tx.amount) - amountMinor <= 100000 &&
        tx.currency === "NGN" &&
        w.currency === "NGN";

      if (!verified) {
        return res.status(409).json({
          error: "Wallet payment could not be verified. Do not pay again; keep the reference and contact GRIM Customer Care."
        });
      }

      const { data: ledger, error } = await supabase.rpc("grim_wallet_credit", {
        p_customer_id: customer.id,
        p_currency: "NGN",
        p_amount_minor: amountMinor,
        p_source: "paystack",
        p_payment_reference: reference,
        p_description: "GRIM Wallet funding",
        p_idempotency_key: `wallet-fund:${reference}`
      });
      if (error) throw error;

      return res.json({
        ok: true,
        verified: true,
        reference,
        amountMinor,
        currency: "NGN",
        ledger
      });
    } catch (e) {
      console.error("[GRIM V8 wallet fund verify]", e);
      return res.status(e.statusCode || 500).json({ error: e.message || "Unable to verify wallet funding." });
    }
  });

  // Start a persistent customer-care conversation.
  app.post("/api/v8/support/conversations", async (req, res) => {
    if (!dbReady(res)) return;
    try {
      const customer = await customerFor(req, res);
      if (!customer) return;

      const subject = clean(req.body?.subject || req.body?.topic || "Customer Care", 140);
      const category = clean(req.body?.category || req.body?.topic || "general", 60);
      const orderRef = clean(req.body?.orderRef || req.body?.order || "", 80) || null;
      const message = clean(req.body?.message, 4000);
      const source = clean(req.body?.source || "customer_care", 40);

      if (!message) {
        return res.status(400).json({ error: "Tell GRIM Customer Care how we can help." });
      }

      const { data: conversation, error: cErr } = await supabase
        .from("support_conversations")
        .insert({
          customer_id: customer.id,
          customer_name: customer.name || [customer.first_name, customer.last_name].filter(Boolean).join(" "),
          customer_email: customer.email,
          subject,
          category,
          order_ref: orderRef,
          status: "waiting_agent",
          priority: ["payment", "charged", "account"].includes(category.toLowerCase()) ? "high" : "normal",
          source,
          last_message_at: new Date().toISOString()
        })
        .select("id,status,priority,created_at")
        .single();
      if (cErr) throw cErr;

      const { error: mErr } = await supabase.from("support_messages").insert({
        conversation_id: conversation.id,
        sender_type: source === "grim_assist" ? "assistant" : "customer",
        sender_name: customer.name || "Customer",
        message,
        read_by_customer: true,
        read_by_agent: false
      });
      if (mErr) throw mErr;

      await supabase.from("support_events").insert({
        conversation_id: conversation.id,
        event_type: "conversation_created",
        actor_type: "customer",
        metadata: { source, category }
      });

      return res.status(201).json({ ok: true, conversation });
    } catch (e) {
      console.error("[GRIM V8 support create]", e);
      return res.status(500).json({ error: "Unable to contact GRIM Customer Care right now." });
    }
  });

  // List only the signed-in customer's conversations.
  app.get("/api/v8/support/conversations", async (req, res) => {
    if (!dbReady(res)) return;
    try {
      const customer = await customerFor(req, res);
      if (!customer) return;

      const { data, error } = await supabase
        .from("support_conversations")
        .select("id,subject,category,order_ref,status,priority,assigned_agent,last_message_at,created_at,updated_at")
        .eq("customer_id", customer.id)
        .order("last_message_at", { ascending: false })
        .limit(30);
      if (error) throw error;

      res.setHeader("Cache-Control", "no-store");
      return res.json({ ok: true, conversations: data || [] });
    } catch (e) {
      console.error("[GRIM V8 support list]", e);
      return res.status(500).json({ error: "Unable to load Customer Care conversations." });
    }
  });

  // Read one conversation after ownership verification.
  app.get("/api/v8/support/conversations/:id", async (req, res) => {
    if (!dbReady(res)) return;
    try {
      const customer = await customerFor(req, res);
      if (!customer) return;
      const id = clean(req.params.id, 80);

      const { data: conversation, error: cErr } = await supabase
        .from("support_conversations")
        .select("*")
        .eq("id", id)
        .eq("customer_id", customer.id)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!conversation) return res.status(404).json({ error: "Conversation not found." });

      const { data: messages, error: mErr } = await supabase
        .from("support_messages")
        .select("id,sender_type,sender_name,message,read_by_customer,created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true });
      if (mErr) throw mErr;

      await supabase
        .from("support_messages")
        .update({ read_by_customer: true })
        .eq("conversation_id", id)
        .eq("read_by_customer", false);

      return res.json({ ok: true, conversation, messages: messages || [] });
    } catch (e) {
      console.error("[GRIM V8 support read]", e);
      return res.status(500).json({ error: "Unable to load this conversation." });
    }
  });

  // Customer reply; ownership is checked before insert.
  app.post("/api/v8/support/conversations/:id/messages", async (req, res) => {
    if (!dbReady(res)) return;
    try {
      const customer = await customerFor(req, res);
      if (!customer) return;
      const id = clean(req.params.id, 80);
      const message = clean(req.body?.message, 4000);
      if (!message) return res.status(400).json({ error: "Message is required." });

      const { data: conversation, error: cErr } = await supabase
        .from("support_conversations")
        .select("id,status")
        .eq("id", id)
        .eq("customer_id", customer.id)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!conversation) return res.status(404).json({ error: "Conversation not found." });
      if (conversation.status === "closed") {
        return res.status(409).json({ error: "This conversation is closed." });
      }

      const now = new Date().toISOString();
      const { data: row, error: mErr } = await supabase
        .from("support_messages")
        .insert({
          conversation_id: id,
          sender_type: "customer",
          sender_name: customer.name || "Customer",
          message,
          read_by_customer: true,
          read_by_agent: false
        })
        .select("id,sender_type,sender_name,message,created_at")
        .single();
      if (mErr) throw mErr;

      await supabase
        .from("support_conversations")
        .update({ status: "waiting_agent", last_message_at: now })
        .eq("id", id)
        .eq("customer_id", customer.id);

      return res.status(201).json({ ok: true, message: row });
    } catch (e) {
      console.error("[GRIM V8 support reply]", e);
      return res.status(500).json({ error: "Unable to send your message." });
    }
  });
}

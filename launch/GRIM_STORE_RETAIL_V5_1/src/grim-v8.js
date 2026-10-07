// GRIM V8 — wallet + persistent customer care API foundation.
// Requires the V8 Supabase migration already installed.

export function installGrimV8(app, { supabase }) {
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

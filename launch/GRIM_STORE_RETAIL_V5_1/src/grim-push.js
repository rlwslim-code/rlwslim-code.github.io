import webpush from "web-push";
import crypto from "node:crypto";

export function installGrimPush(app, { supabase } = {}) {
  const clean = (v, n = 500) => String(v ?? "").trim().slice(0, n);
  const cleanEmail = v => clean(v, 200).toLowerCase();
  const publicKey = clean(process.env.VAPID_PUBLIC_KEY, 300);
  const privateKey = clean(process.env.VAPID_PRIVATE_KEY, 300);
  const subject = clean(process.env.VAPID_SUBJECT || "https://grimwear.store", 300);

  if (publicKey && privateKey) webpush.setVapidDetails(subject, publicKey, privateKey);

  function ready(res) {
    if (!supabase) { res.status(503).json({ error: "GRIM push storage is unavailable." }); return false; }
    if (!publicKey || !privateKey) { res.status(503).json({ error: "GRIM push notifications are not configured yet." }); return false; }
    return true;
  }

  async function customer(req, res) {
    const email = cleanEmail(req.session?.user?.email);
    if (!email) { res.status(401).json({ error: "Sign in to continue." }); return null; }
    const { data, error } = await supabase.from("customers").select("id,email").eq("email", email).maybeSingle();
    if (error) throw error;
    if (!data) { res.status(404).json({ error: "GRIM customer account was not found." }); return null; }
    return data;
  }

  app.get("/api/push/config", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!publicKey) return res.status(503).json({ error: "GRIM push notifications are not configured yet." });
    return res.json({ ok: true, publicKey });
  });

  app.post("/api/push/subscribe", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!ready(res)) return;
    try {
      const c = await customer(req, res); if (!c) return;
      const sub = req.body?.subscription || {};
      const endpoint = clean(sub.endpoint, 2000);
      const p256dh = clean(sub.keys?.p256dh, 500);
      const auth = clean(sub.keys?.auth, 500);
      if (!endpoint.startsWith("https://") || !p256dh || !auth) return res.status(400).json({ error: "Invalid push subscription." });
      const endpointHash = crypto.createHash("sha256").update(endpoint).digest("hex");
      const row = { customer_id: c.id, endpoint_hash: endpointHash, endpoint, p256dh, auth, user_agent: clean(req.get("user-agent"), 500), active: true, updated_at: new Date().toISOString() };
      const { error } = await supabase.from("push_subscriptions").upsert(row, { onConflict: "endpoint_hash" });
      if (error) throw error;
      return res.json({ ok: true });
    } catch (e) {
      console.error("[GRIM push subscribe]", e);
      return res.status(500).json({ error: "Unable to enable push notifications." });
    }
  });

  app.post("/api/push/unsubscribe", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!supabase) return res.status(503).json({ error: "GRIM push storage is unavailable." });
    try {
      const c = await customer(req, res); if (!c) return;
      const endpoint = clean(req.body?.endpoint, 2000);
      if (!endpoint) return res.status(400).json({ error: "Push endpoint is required." });
      const endpointHash = crypto.createHash("sha256").update(endpoint).digest("hex");
      const { error } = await supabase.from("push_subscriptions").update({ active: false, updated_at: new Date().toISOString() }).eq("customer_id", c.id).eq("endpoint_hash", endpointHash);
      if (error) throw error;
      return res.json({ ok: true });
    } catch (e) {
      console.error("[GRIM push unsubscribe]", e);
      return res.status(500).json({ error: "Unable to disable push notifications." });
    }
  });

  // Protected sender endpoint. Never expose GRIM_PUSH_ADMIN_KEY in browser code.
  app.post("/api/push/admin/send", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!ready(res)) return;
    const configuredAdminKey = clean(process.env.GRIM_PUSH_ADMIN_KEY, 500);
    const supplied = clean(req.get("x-grim-admin-key"), 500);
    if (!configuredAdminKey || supplied.length !== configuredAdminKey.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configuredAdminKey))) {
      return res.status(403).json({ error: "Not authorized." });
    }
    try {
      const title = clean(req.body?.title || "GRIM", 80);
      const body = clean(req.body?.body, 180);
      const url = clean(req.body?.url || "/", 500);
      const category = clean(req.body?.category || "general", 40).toLowerCase();
      if (!body) return res.status(400).json({ error: "Notification message is required." });

      let q = supabase.from("push_subscriptions").select("id,customer_id,endpoint,p256dh,auth").eq("active", true).limit(5000);
      const { data: subscriptions, error } = await q;
      if (error) throw error;

      // Respect the customer's category preference when one exists.
      const customerIds = [...new Set((subscriptions || []).map(x => x.customer_id))];
      const prefs = new Map();
      if (customerIds.length) {
        const { data: customers } = await supabase.from("customers").select("id,notifications").in("id", customerIds);
        for (const c of customers || []) prefs.set(String(c.id), c.notifications || {});
      }
      const prefKey = { orders:"orders", wallet:"wallet", drops:"drops", restocks:"restocks", promotions:"promotions", house:"houseOfGrim", houseofgrim:"houseOfGrim" }[category];
      const targets = (subscriptions || []).filter(s => !prefKey || prefs.get(String(s.customer_id))?.[prefKey] !== false);
      const payload = JSON.stringify({ title, body, url, category, icon: "/grim-icon-192.png", badge: "/grim-icon-192.png" });
      let sent = 0, removed = 0, failed = 0;
      for (const s of targets) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: category === "orders" || category === "wallet" ? "high" : "normal" });
          sent++;
        } catch (e) {
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await supabase.from("push_subscriptions").update({ active: false, updated_at: new Date().toISOString() }).eq("id", s.id);
            removed++;
          } else { failed++; console.error("[GRIM push send]", e?.statusCode || e); }
        }
      }
      return res.json({ ok: true, sent, failed, expiredRemoved: removed, targeted: targets.length });
    } catch (e) {
      console.error("[GRIM push admin]", e);
      return res.status(500).json({ error: "Unable to send GRIM notifications." });
    }
  });
}

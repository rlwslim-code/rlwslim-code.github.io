import bcrypt from "bcryptjs";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";

/*
 GRIM V6 services
 - persistent customers in Supabase
 - GRIM Wallet (Paystack funding + atomic server-side debit)
 - customer order history
 - persistent support tickets
 - FAQ + GRIM ASSIST knowledge API

 Install this BEFORE the legacy /api/register, /api/login and /api/auth/google
 routes. The middleware intercepts those paths so old SQLite auth is bypassed.
*/
export function installGrimV6(app, { supabase }) {
  const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || undefined);
  const PAYSTACK = "https://api.paystack.co";

  const cleanEmail = v => String(v || "").trim().toLowerCase();
  const clean = (v, n=160) => String(v || "").trim().slice(0,n);
  const money = v => Math.max(0, Math.round(Number(v || 0)));
  const sha256 = v => crypto.createHash("sha256").update(String(v)).digest("hex");
  const newOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

  async function sendTwoFactorCode(email, code) {
    // Uses Resend's HTTPS API without adding another npm dependency.
    // Configure RESEND_API_KEY and TWO_FACTOR_FROM_EMAIL in Vercel.
    if (!process.env.RESEND_API_KEY || !process.env.TWO_FACTOR_FROM_EMAIL)
      throw new Error("2FA email delivery is not configured.");

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.TWO_FACTOR_FROM_EMAIL,
        to: [email],
        subject: "Your GRIM sign-in code",
        html: `<div style="background:#090909;color:#eee;padding:32px;font-family:Arial,sans-serif">
          <div style="letter-spacing:3px;font-weight:700">GRIM</div>
          <h2>Verify your sign-in</h2>
          <p>Use this one-time code to finish signing in:</p>
          <div style="font-size:34px;letter-spacing:8px;font-weight:800">${code}</div>
          <p style="color:#aaa">This code expires in 10 minutes. If you did not try to sign in, you can ignore this email.</p>
        </div>`
      })
    });
    if (!r.ok) throw new Error("Unable to send verification email.");
  }

  async function issueTwoFactor(customer, req) {
    const code = newOtp();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await supabase.from("two_factor_challenges").insert({
      customer_id: customer.id,
      code_hash: sha256(code),
      expires_at: expires,
      attempts_remaining: 5,
      request_ip: clean(req.headers["x-forwarded-for"] || req.ip || "", 160)
    });
    if (error) throw error;
    await sendTwoFactorCode(customer.email, code);
    req.session.pending2fa = {
      customerId: customer.id,
      email: customer.email,
      issuedAt: Date.now()
    };
  }
  const emailOK = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const passwordOK = p => typeof p === "string" && p.length >= 8 &&
    /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);

  function requireDb(res) {
    if (!supabase) {
      res.status(503).json({ error: "GRIM account services are temporarily unavailable." });
      return false;
    }
    return true;
  }
  function requireUser(req, res) {
    if (!req.session?.user?.email) {
      res.status(401).json({ error: "Sign in to continue." });
      return null;
    }
    return req.session.user;
  }
  async function customerByEmail(email) {
    const { data, error } = await supabase.from("customers").select("*")
      .eq("email", cleanEmail(email)).maybeSingle();
    if (error) throw error;
    return data;
  }
  function sessionUser(row) {
    return {
      id: row.id,
      name: row.name,
      firstName: row.first_name || undefined,
      lastName: row.last_name || undefined,
      email: row.email,
      phone: row.phone || undefined
    };
  }

  // Intercept legacy auth endpoints before SQLite routes.
  app.use(async (req, res, next) => {
    if (!supabase) return next();

    try {
      if (req.method === "POST" && req.path === "/api/register") {
        const { name, firstName, lastName, email, phone, password } = req.body || {};
        const normalizedEmail = cleanEmail(email);
        const displayName = clean(name || `${firstName || ""} ${lastName || ""}`);

        if (!displayName || !normalizedEmail || !phone)
          return res.status(400).json({ error: "Complete all required account fields." });
        if (!emailOK(normalizedEmail))
          return res.status(400).json({ error: "Enter a valid email address." });
        if (!passwordOK(password))
          return res.status(400).json({ error: "Complete all password requirements." });

        if (await customerByEmail(normalizedEmail))
          return res.status(400).json({ error: "Email already registered." });

        const passwordHash = await bcrypt.hash(password, 12);
        const { data, error } = await supabase.from("customers").insert({
          name: displayName,
          first_name: clean(firstName,80) || null,
          last_name: clean(lastName,80) || null,
          email: normalizedEmail,
          phone: clean(phone,80),
          password_hash: passwordHash,
          auth_provider: "password"
        }).select("*").single();
        if (error) throw error;

        req.session.user = sessionUser(data);
        return res.json(req.session.user);
      }

      if (req.method === "POST" && req.path === "/api/login") {
        const email = cleanEmail(req.body?.email);
        const user = await customerByEmail(email);
        if (!user?.password_hash ||
            !(await bcrypt.compare(String(req.body?.password || ""), user.password_hash))) {
          return res.status(401).json({ error: "Incorrect email or password." });
        }
        // If the customer has 2FA enabled, require the email code.
if (user.two_factor_enabled === true) {
  delete req.session.user;

  await issueTwoFactor(user, req);

  return res.json({
    ok: true,
    requiresTwoFactor: true,
    emailHint: user.email.replace(
      /^(.{1,2}).*(@.*)$/,
      "$1***$2"
    )
  });
}

// 2FA is disabled — complete sign-in immediately.
req.session.user = sessionUser(user);
delete req.session.pending2fa;

await supabase
  .from("customers")
  .update({
    last_login_at: new Date().toISOString()
  })
  .eq("id", user.id);

return res.json({
  ok: true,
  requiresTwoFactor: false,
  user: req.session.user
});
      }

      if (req.method === "POST" && req.path === "/api/auth/google") {
        if (!process.env.GOOGLE_CLIENT_ID)
          return res.status(503).json({ error: "Google Sign-In is not configured." });
        const credential = clean(req.body?.credential, 5000);
        if (!credential) return res.status(400).json({ error: "Google credential is required." });

        const ticket = await googleClient.verifyIdToken({
          idToken: credential, audience: process.env.GOOGLE_CLIENT_ID
        });
        const profile = ticket.getPayload();
        if (!profile?.email || profile.email_verified === false)
          return res.status(401).json({ error: "Google could not verify this email address." });

        const email = cleanEmail(profile.email);
        let user = await customerByEmail(email);
        let newUser = false;

        if (!user) {
          const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
          const { data, error } = await supabase.from("customers").insert({
            name: clean(profile.name || email.split("@")[0]),
            first_name: clean(profile.given_name,80) || null,
            last_name: clean(profile.family_name,80) || null,
            email,
            phone: null,
            password_hash: unusablePassword,
            auth_provider: "google",
            google_sub: clean(profile.sub,200)
          }).select("*").single();
          if (error) throw error;
          user = data;
          newUser = true;
        }

        req.session.user = sessionUser(user);
        return res.json({ ok:true, ...req.session.user, newUser });
      }
    } catch (err) {
      console.error("[GRIM V6 auth]", err);
      return res.status(500).json({ error: "Unable to complete account request right now." });
    }
    next();
  });

  app.post("/api/auth/2fa/verify", async (req,res) => {
    if (!requireDb(res)) return;
    const pending = req.session?.pending2fa;
    const code = clean(req.body?.code, 12);
    if (!pending?.customerId) return res.status(401).json({error:"Start sign-in again."});
    if (!/^\d{6}$/.test(code)) return res.status(400).json({error:"Enter the 6-digit code."});

    try {
      const { data: challenge, error } = await supabase.from("two_factor_challenges")
        .select("*").eq("customer_id", pending.customerId).eq("used", false)
        .order("created_at", {ascending:false}).limit(1).maybeSingle();
      if (error) throw error;
      if (!challenge || new Date(challenge.expires_at).getTime() < Date.now())
        return res.status(400).json({error:"That code expired. Request a new code."});
      if (challenge.attempts_remaining <= 0)
        return res.status(429).json({error:"Too many attempts. Request a new code."});

      if (sha256(code) !== challenge.code_hash) {
        await supabase.from("two_factor_challenges")
          .update({attempts_remaining:challenge.attempts_remaining-1}).eq("id",challenge.id);
        return res.status(400).json({error:"Incorrect verification code."});
      }

      await supabase.from("two_factor_challenges")
        .update({used:true, used_at:new Date().toISOString()}).eq("id",challenge.id);
      const {data:user,error:userErr}=await supabase.from("customers")
        .select("*").eq("id",pending.customerId).single();
      if(userErr) throw userErr;

      req.session.user=sessionUser(user);
      delete req.session.pending2fa;
      await supabase.from("customers").update({last_login_at:new Date().toISOString()}).eq("id",user.id);
      return res.json({ok:true,user:req.session.user});
    } catch(e) {
      console.error("[GRIM V6 2FA verify]",e);
      res.status(500).json({error:"Unable to verify the code right now."});
    }
  });

  app.post("/api/auth/2fa/resend", async (req,res) => {
    if (!requireDb(res)) return;
    const pending=req.session?.pending2fa;
    if(!pending?.customerId) return res.status(401).json({error:"Start sign-in again."});
    if(Date.now()-Number(pending.issuedAt||0)<60000)
      return res.status(429).json({error:"Wait one minute before requesting another code."});
    try{
      const {data:user,error}=await supabase.from("customers").select("*").eq("id",pending.customerId).single();
      if(error) throw error;
      await issueTwoFactor(user,req);
      res.json({ok:true});
    }catch(e){
      console.error("[GRIM V6 2FA resend]",e);
      res.status(500).json({error:"Unable to resend the code right now."});
    }
  });

  app.post("/api/auth/email-code/verify", async (req, res) => {
    if (!requireDb(res)) return;

    const pending = req.session?.pendingEmailCode;
    const code = clean(req.body?.code, 12);

    if (!pending?.customerId) {
      return res.status(401).json({
        error: "Request a new sign-in code."
      });
    }

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        error: "Enter the 6-digit code."
      });
    }

    try {
      const { data: challenge, error } = await supabase
        .from("two_factor_challenges")
        .select("*")
        .eq("customer_id", pending.customerId)
        .eq("used", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (
        !challenge ||
        new Date(challenge.expires_at).getTime() < Date.now()
      ) {
        return res.status(400).json({
          error: "That code expired. Request a new code."
        });
      }

      if (challenge.attempts_remaining <= 0) {
        return res.status(429).json({
          error: "Too many attempts. Request a new code."
        });
      }

      if (sha256(code) !== challenge.code_hash) {
        await supabase
          .from("two_factor_challenges")
          .update({
            attempts_remaining:
              challenge.attempts_remaining - 1
          })
          .eq("id", challenge.id);

        return res.status(400).json({
          error: "Incorrect sign-in code."
        });
      }

      await supabase
        .from("two_factor_challenges")
        .update({
          used: true,
          used_at: new Date().toISOString()
        })
        .eq("id", challenge.id);

      const { data: user, error: userErr } = await supabase
        .from("customers")
        .select("*")
        .eq("id", pending.customerId)
        .single();

      if (userErr) throw userErr;

      req.session.user = sessionUser(user);
      delete req.session.pendingEmailCode;
      delete req.session.pending2fa;

      await supabase
        .from("customers")
        .update({
          last_login_at: new Date().toISOString()
        })
        .eq("id", user.id);

      return res.json({
        ok: true,
        user: req.session.user
      });
    } catch (e) {
      console.error("[GRIM email-code verify]", e);

      return res.status(500).json({
        error: "Unable to verify the sign-in code right now."
      });
    }
  });
  app.get("/api/account", async (req,res) => {
    if (!requireDb(res)) return;
    const session = requireUser(req,res); if (!session) return;
    try {
      const user = await customerByEmail(session.email);
      if (!user) return res.status(404).json({error:"Account not found."});
      const { data: txs, error: txErr } = await supabase.from("wallet_transactions")
        .select("id,type,amount,reference,status,note,created_at")
        .eq("customer_id", user.id).order("created_at",{ascending:false}).limit(50);
      if (txErr) throw txErr;
      const { data: orders, error: orderErr } = await supabase.from("orders")
        .select("*").eq("email", user.email).order("created_at",{ascending:false}).limit(30);
      if (orderErr) throw orderErr;
      res.json({
        user: sessionUser(user),
        wallet: { balance: Number(user.wallet_balance || 0), currency:"NGN" },
        transactions: txs || [],
        orders: orders || []
      });
    } catch(e) {
      console.error("[GRIM V6 account]",e);
      res.status(500).json({error:"Unable to load your GRIM account."});
    }
  });

  app.post("/api/wallet/fund/initialize", async (req,res) => {
    if (!requireDb(res)) return;
    const session = requireUser(req,res); if (!session) return;
    const amount = money(req.body?.amount);
    if (amount < 1000 || amount > 1000000)
      return res.status(400).json({error:"Wallet funding must be between ₦1,000 and ₦1,000,000."});
    if (!process.env.PAYSTACK_SECRET_KEY)
      return res.status(503).json({error:"Payments are temporarily unavailable."});

    try {
      const reference = `GRIM-WALLET-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const callback = clean(req.body?.callbackUrl,500) ||
        `${req.protocol}://${req.get("host")}/?wallet=verify&reference=${encodeURIComponent(reference)}`;

      const r = await fetch(`${PAYSTACK}/transaction/initialize`, {
        method:"POST",
        headers:{
          Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          email:session.email,
          amount:amount*100,
          currency:"NGN",
          reference,
          callback_url:callback,
          metadata:{purpose:"grim_wallet_funding"}
        })
      });
      const body = await r.json();
      if (!r.ok || !body.status) throw new Error(body.message || "Paystack initialization failed");
      res.json({ok:true, reference, authorizationUrl:body.data.authorization_url});
    } catch(e) {
      console.error("[GRIM V6 wallet initialize]",e);
      res.status(502).json({error:"Unable to start wallet funding."});
    }
  });

  app.post("/api/wallet/fund/verify", async (req,res) => {
    if (!requireDb(res)) return;
    const session = requireUser(req,res); if (!session) return;
    const reference = clean(req.body?.reference,200);
    if (!reference.startsWith("GRIM-WALLET-"))
      return res.status(400).json({error:"Invalid wallet reference."});

    try {
      const r = await fetch(`${PAYSTACK}/transaction/verify/${encodeURIComponent(reference)}`, {
        headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`}
      });
      const body = await r.json();
      const p = body?.data;
      if (!r.ok || !body.status || p?.status !== "success")
        return res.status(400).json({error:"Wallet payment has not been verified."});
      if (cleanEmail(p.customer?.email) !== cleanEmail(session.email))
        return res.status(400).json({error:"Payment customer does not match this account."});
      if (String(p.currency).toUpperCase() !== "NGN")
        return res.status(400).json({error:"Unexpected payment currency."});

      const amount = Math.round(Number(p.amount || 0)/100);
      const { data, error } = await supabase.rpc("grim_credit_wallet", {
        p_email: cleanEmail(session.email),
        p_amount: amount,
        p_reference: reference,
        p_note: "Paystack wallet funding"
      });
      if (error) throw error;
      res.json({ok:true, balance:Number(data || 0), amount, currency:"NGN"});
    } catch(e) {
      console.error("[GRIM V6 wallet verify]",e);
      res.status(500).json({error:"Unable to verify wallet funding."});
    }
  });

  app.post("/api/wallet/pay", async (req,res) => {
    if (!requireDb(res)) return;
    const session = requireUser(req,res); if (!session) return;
    const amount = money(req.body?.amount);
    const orderRef = clean(req.body?.orderRef,120);
    if (!amount || !orderRef) return res.status(400).json({error:"Invalid wallet payment."});
    try {
      const { data, error } = await supabase.rpc("grim_debit_wallet", {
        p_email: cleanEmail(session.email),
        p_amount: amount,
        p_reference: `WALLET-${orderRef}`,
        p_note: `GRIM order ${orderRef}`
      });
      if (error) {
        if (/insufficient/i.test(error.message || ""))
          return res.status(400).json({error:"Insufficient GRIM Wallet balance."});
        throw error;
      }
      res.json({ok:true,balance:Number(data || 0),currency:"NGN"});
    } catch(e) {
      console.error("[GRIM V6 wallet pay]",e);
      res.status(500).json({error:"Unable to complete wallet payment."});
    }
  });

  // Persistent support route. Intercepts the legacy SQLite-first route.
  app.use(async (req,res,next) => {
    if (req.method !== "POST" || req.path !== "/api/support" || !supabase) return next();
    const {topic,name,email,order,message} = req.body || {};
    if (!topic || !name || !email || !message)
      return res.status(400).json({error:"Complete the required fields."});
    try {
      const {data,error}=await supabase.from("support_tickets").insert({
        topic:clean(topic,80), name:clean(name,100), email:cleanEmail(email).slice(0,160),
        order_ref:clean(order,50)||null, message:clean(message,3000), status:"open"
      }).select("id").single();
      if(error) throw error;
      res.json({ok:true,ticketId:data.id});
    } catch(e) {
      console.error("[GRIM V6 support]",e);
      res.status(500).json({error:"Unable to send your message right now."});
    }
  });

  const FAQ = [
    {q:"How do GRIM preorders work?",a:"Choose your piece, size and color, complete checkout, and GRIM will confirm your order. Production and dispatch timing is shown with the active drop."},
    {q:"How do I fund my GRIM Wallet?",a:"Sign in, open GRIM Wallet, choose Fund Wallet, enter an amount and complete the secure Paystack payment. Your balance updates only after payment is verified."},
    {q:"Can I withdraw my wallet balance?",a:"GRIM Wallet is currently store credit for purchases on GRIM. Cash withdrawals and customer-to-customer transfers are not available."},
    {q:"Can I pay directly without the wallet?",a:"Yes. You can continue to use the normal Paystack checkout where available."},
    {q:"How do I check an order?",a:"Sign in and open your Account Center. Your recent orders appear under Orders. For a problem, open Customer Care and include the order reference."},
    {q:"What sizes are available?",a:"Available sizes are shown on each product. If you are unsure, contact GRIM Customer Care before ordering."},
    {q:"Can I change an order?",a:"Contact Customer Care as soon as possible with your order reference. Changes depend on whether production or fulfillment has started."},
    {q:"How do returns or exchanges work?",a:"Eligibility depends on the item and its condition. Contact Customer Care with your order reference before returning anything."},
    {q:"Is my wallet balance secure?",a:"Wallet credits and debits are recorded on the server. Funding is credited only after Paystack confirms a successful payment."}
  ];
  app.get("/api/faqs", (_req,res)=>res.json(FAQ));
  app.post("/api/assist", async (req,res)=>{
    const q=clean(req.body?.message,800).toLowerCase();
    if(!q) return res.status(400).json({error:"Ask GRIM ASSIST a question."});
    const words=q.split(/\W+/).filter(w=>w.length>2);
    let best=null,score=0;
    for(const f of FAQ){
      const hay=(f.q+" "+f.a).toLowerCase();
      const s=words.reduce((n,w)=>n+(hay.includes(w)?1:0),0);
      if(s>score){score=s;best=f;}
    }
    if(best && score>0) return res.json({answer:best.a,source:"faq",escalate:false});
    res.json({
      answer:"I’m not certain enough to give you the wrong answer. Send this to GRIM Customer Care and the team can help you directly.",
      source:"fallback",escalate:true
    });
  });
}

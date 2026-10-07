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
export function installGrimV6(app, { supabase, persistentAuth } = {}) {
  const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || undefined);
  const PAYSTACK = "https://api.paystack.co";

  const cleanEmail = v => String(v || "").trim().toLowerCase();
  const clean = (v, n=160) => String(v || "").trim().slice(0,n);
  const money = v => Math.max(0, Math.round(Number(v || 0)));
  const sha256 = v => crypto.createHash("sha256").update(String(v)).digest("hex");
  const newOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

  const authSecret = String(process.env.SESSION_SECRET || "");
  const b64u = v => Buffer.from(String(v)).toString("base64url");
  const unb64u = v => Buffer.from(String(v), "base64url").toString();
  const sign = v => {
    if (!authSecret) throw new Error("SESSION_SECRET is required for secure account challenges.");
    return crypto.createHmac("sha256", authSecret).update(String(v)).digest("base64url");
  };
  const makeToken = payload => {
    const body = b64u(JSON.stringify(payload));
    return `${body}.${sign(body)}`;
  };
  const readToken = token => {
    try {
      const [body, sig] = String(token || "").split(".");
      if (!body || !sig) return null;
      const expected = sign(body);
      const a = Buffer.from(sig), b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return null;
      const payload = JSON.parse(unb64u(body));
      if (!payload?.exp || Date.now() > Number(payload.exp)) return null;
      return payload;
    } catch { return null; }
  };
  const cookieValue = (req, name) => {
    const raw = String(req.headers?.cookie || "");
    const hit = raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(`${name}=`));
    return hit ? decodeURIComponent(hit.slice(name.length+1)) : "";
  };
  const secureCookie = () => process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  const setChallengeCookie = (res, name, value, maxAge) => res.cookie(name, value, {
    httpOnly:true, secure:secureCookie(), sameSite:"lax", path:"/", maxAge
  });
  const clearChallengeCookie = (res, name) => res.clearCookie(name, {
    httpOnly:true, secure:secureCookie(), sameSite:"lax", path:"/"
  });

  async function sendGrimEmail({to, subject, heading, text, code}) {
    if (!process.env.RESEND_API_KEY || !process.env.TWO_FACTOR_FROM_EMAIL)
      throw new Error("GRIM email delivery is not configured.");
    const r = await fetch("https://api.resend.com/emails", {
      method:"POST",
      headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        from:process.env.TWO_FACTOR_FROM_EMAIL,
        to:[to],
        subject,
        html:`<div style="background:#090909;color:#eee;padding:32px;font-family:Arial,sans-serif">
          <div style="letter-spacing:3px;font-weight:700">GRIM</div>
          <h2>${heading}</h2>
          <p>${text}</p>
          <div style="font-size:34px;letter-spacing:8px;font-weight:800">${code}</div>
          <p style="color:#aaa">This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>
        </div>`
      })
    });
    if(!r.ok){
      const body=await r.json().catch(()=>({}));
      console.error("[GRIM email]",r.status,body);
      throw new Error("Unable to send GRIM email.");
    }
  }
  const sendTwoFactorCode=(email,code)=>sendGrimEmail({
    to:email,subject:"Your GRIM sign-in code",heading:"Verify your sign-in",
    text:"Use this one-time code to finish signing in:",code
  });
  const sendResetCode=(email,code)=>sendGrimEmail({
    to:email,subject:"Reset your GRIM password",heading:"Reset your password",
    text:"Use this one-time code to reset your GRIM password:",code
  });

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
    const issuedAt=Date.now();
    req.session.pending2fa = { customerId:customer.id, email:customer.email, issuedAt };
    setChallengeCookie(req.res, "grim.2fa", makeToken({
      kind:"2fa", customerId:customer.id, email:customer.email,
      issuedAt, exp:issuedAt + 10*60*1000
    }), 10*60*1000);
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

  // Restore the signed-in customer when Vercel gives this request a fresh serverless instance.
  app.use(async (req,res,next)=>{
    if(!supabase || req.session?.user?.email || !persistentAuth?.readEmail) return next();
    try{
      const email=cleanEmail(persistentAuth.readEmail(req));
      if(!email) return next();
      const user=await customerByEmail(email);
      if(!user || user.account_status==="disabled" || user.account_status==="suspended"){
        persistentAuth.clear?.(res);
        return next();
      }
      req.session.user=sessionUser(user);
    }catch(e){ console.error("[GRIM persistent auth restore]",e); }
    next();
  });

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
        persistentAuth?.set?.(res, data.email);
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
persistentAuth?.set?.(res, user.email);

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

        const googlePatch = {
          auth_provider: user.auth_provider === "password" ? "password" : "google",
          google_sub: clean(profile.sub,200),
          google_connected: true,
          last_login_at: new Date().toISOString()
        };
        const {data:googleUser,error:googleErr}=await supabase.from("customers")
          .update(googlePatch).eq("id",user.id).select("*").single();
        if(googleErr) throw googleErr;
        user=googleUser;
        req.session.user = sessionUser(user);
        persistentAuth?.set?.(res, user.email);
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
    const tokenPending=readToken(cookieValue(req,"grim.2fa"));
    const pending = req.session?.pending2fa || (tokenPending?.kind==="2fa" ? tokenPending : null);
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
      clearChallengeCookie(res,"grim.2fa");
      persistentAuth?.set?.(res,user.email);
      await supabase.from("customers").update({last_login_at:new Date().toISOString()}).eq("id",user.id);
      return res.json({ok:true,user:req.session.user});
    } catch(e) {
      console.error("[GRIM V6 2FA verify]",e);
      res.status(500).json({error:"Unable to verify the code right now."});
    }
  });

  app.post("/api/auth/2fa/resend", async (req,res) => {
    if (!requireDb(res)) return;
    const tokenPending=readToken(cookieValue(req,"grim.2fa"));
    const pending=req.session?.pending2fa || (tokenPending?.kind==="2fa" ? tokenPending : null);
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
 

  app.post("/api/auth/legacy-forgot-password", async (req,res)=>{
    if(!requireDb(res)) return;
    const email=cleanEmail(req.body?.email);
    // Same outward response prevents account enumeration.
    const safe={ok:true,message:"If that email belongs to a GRIM account, a reset code has been sent."};
    if(!emailOK(email)) return res.json(safe);
    try{
      const user=await customerByEmail(email);
      if(!user) return res.json(safe);
      const code=newOtp(), issuedAt=Date.now();
      const token=makeToken({
        kind:"reset", customerId:user.id, email:user.email,
        codeHash:sha256(code), attempts:5, issuedAt, exp:issuedAt+10*60*1000
      });
      setChallengeCookie(res,"grim.reset",token,10*60*1000);
      await sendResetCode(user.email,code);
      return res.json(safe);
    }catch(e){
      console.error("[GRIM password reset request]",e);
      return res.status(500).json({error:"Unable to send the reset code right now."});
    }
  });

  app.post("/api/auth/legacy-reset-password", async (req,res)=>{
    if(!requireDb(res)) return;
    const email=cleanEmail(req.body?.email), code=clean(req.body?.code,12);
    const newPassword=String(req.body?.newPassword||"");
    const token=readToken(cookieValue(req,"grim.reset"));
    if(!token || token.kind!=="reset" || cleanEmail(token.email)!==email)
      return res.status(400).json({error:"That reset request expired. Request a new code."});
    if(!/^\d{6}$/.test(code)) return res.status(400).json({error:"Enter the 6-digit code."});
    if(sha256(code)!==token.codeHash)
      return res.status(400).json({error:"Incorrect reset code."});
    if(!passwordOK(newPassword))
      return res.status(400).json({error:"Password must include uppercase, lowercase, number and special character."});
    try{
      const passwordHash=await bcrypt.hash(newPassword,12);
      const {data:user,error}=await supabase.from("customers").update({
        password_hash:passwordHash,
        password_changed_at:new Date().toISOString(),
        auth_provider:"password"
      }).eq("id",token.customerId).eq("email",email).select("*").single();
      if(error) throw error;
      clearChallengeCookie(res,"grim.reset");
      req.session.user=sessionUser(user);
      persistentAuth?.set?.(res,user.email);
      return res.json({ok:true,message:"Password reset successfully.",user:req.session.user});
    }catch(e){
      console.error("[GRIM password reset verify]",e);
      return res.status(500).json({error:"Unable to reset the password right now."});
    }
  });

  app.post("/api/logout",(req,res)=>{
    persistentAuth?.clear?.(res);
    clearChallengeCookie(res,"grim.2fa");
    clearChallengeCookie(res,"grim.reset");
    if(!req.session) return res.json({ok:true});
    req.session.destroy(()=>res.json({ok:true}));
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
    // CUSTOMER SETTINGS
  app.get("/api/settings", async (req, res) => {
    if (!requireDb(res)) return;
    const session = requireUser(req, res);
    if (!session) return;

    try {
      const user = await customerByEmail(session.email);
      if (!user) return res.status(404).json({ error: "Account not found." });

      return res.json({
        ok: true,
        profile: {
  firstName: user.first_name || "",
  lastName: user.last_name || "",
  name: user.name || "",
  email: user.email || "",
  phone: user.phone || "",
  birthday: user.birthday || "",
  preferredSize: user.preferred_size || "",
  shippingAddress: user.shipping_address || {}
},

security: {
  twoFactorEnabled: user.two_factor_enabled === true,
  googleConnected: user.google_connected === true,
  passwordChangedAt: user.password_changed_at || null,
  lastLoginAt: user.last_login_at || null
},

appearance: user.theme_preference || "system",

shopping: {
  preferredColorways: user.preferred_colorways || [],
  checkoutPreferences: user.checkout_preferences || {}
},

notifications: {
  orders: user.notify_orders !== false,
  wallet: user.notify_wallet !== false,
  drops: user.notify_drops !== false,
  restocks: user.notify_restocks !== false,
  promotions: user.notify_promotions === true,
  houseOfGrim: user.notify_house_of_grim !== false
},

privacy: {
  marketingConsent: user.marketing_consent === true,
  accountStatus: user.account_status || "active"
}
      });
    } catch (e) {
      console.error("[GRIM settings]", e);
      return res.status(500).json({ error: "Unable to load settings." });
    }
  });

  app.post("/api/settings/profile", async (req, res) => {
    if (!requireDb(res)) return;
    const session = requireUser(req, res);
    if (!session) return;

    const firstName = clean(req.body?.firstName, 80);
    const lastName = clean(req.body?.lastName, 80);
    const phone = clean(req.body?.phone, 80);
    const birthday = clean(req.body?.birthday, 20) || null;
    const preferredSize = clean(req.body?.preferredSize, 20) || null;
    const shippingAddress = typeof req.body?.shippingAddress === "object"
      ? req.body.shippingAddress
      : (clean(req.body?.shippingAddress, 1000) || null);

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "First and last name are required." });
    }

    try {
      const { data, error } = await supabase
        .from("customers")
        .update({
          first_name: firstName,
          last_name: lastName,
          name: `${firstName} ${lastName}`.trim(),
          phone,
          birthday,
          preferred_size: preferredSize,
          shipping_address: shippingAddress
        })
        .eq("email", session.email)
        .select("*")
        .single();

      if (error) throw error;

      req.session.user = sessionUser(data);

      return res.json({
        ok: true,
        user: req.session.user
      });
    } catch (e) {
      console.error("[GRIM profile settings]", e);
      return res.status(500).json({ error: "Unable to update your information." });
    }
  });

  app.post("/api/settings/2fa", async (req, res) => {
    if (!requireDb(res)) return;
    const session = requireUser(req, res);
    if (!session) return;

    const enabled = req.body?.enabled === true;

    try {
      const { error } = await supabase
        .from("customers")
        .update({ two_factor_enabled: enabled })
        .eq("email", session.email);

      if (error) throw error;

      return res.json({
        ok: true,
        twoFactorEnabled: enabled
      });
    } catch (e) {
      console.error("[GRIM 2FA setting]", e);
      return res.status(500).json({ error: "Unable to update 2FA." });
    }
  });

  app.post("/api/settings/appearance", async (req, res) => {
    if (!requireDb(res)) return;
    const session = requireUser(req, res);
    if (!session) return;

    const theme = String(req.body?.theme || "").toLowerCase();

    if (!["dark", "light", "system"].includes(theme)) {
      return res.status(400).json({ error: "Invalid appearance setting." });
    }

    try {
      const { error } = await supabase
        .from("customers")
        .update({ theme_preference: theme })
        .eq("email", session.email);

      if (error) throw error;

      return res.json({
        ok: true,
        appearance: theme
      });
    } catch (e) {
      console.error("[GRIM appearance setting]", e);
      return res.status(500).json({ error: "Unable to update appearance." });
    }
  });

  app.post("/api/settings/password", async (req, res) => {
    if (!requireDb(res)) return;
    const session = requireUser(req, res);
    if (!session) return;

    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!passwordOK(newPassword)) {
      return res.status(400).json({
        error: "New password must include uppercase, lowercase, number and special character."
      });
    }

    try {
      const user = await customerByEmail(session.email);

      if (!user?.password_hash) {
        return res.status(400).json({
          error: "Password changes are unavailable for this sign-in method."
        });
      }

      const valid = await bcrypt.compare(currentPassword, user.password_hash);

      if (!valid) {
        return res.status(401).json({
          error: "Current password is incorrect."
        });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);

      const { error } = await supabase
        .from("customers")
        .update({ password_hash: passwordHash, password_changed_at:new Date().toISOString() })
        .eq("id", user.id);

      if (error) throw error;

      return res.json({
        ok: true,
        message: "Password changed successfully."
      });
    } catch (e) {
      console.error("[GRIM password settings]", e);
      return res.status(500).json({ error: "Unable to change password." });
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
// ============================================================
// GRIM CUSTOMER SETTINGS — SHOPPING / NOTIFICATIONS / PRIVACY
// ============================================================

// Save shopping preferences
app.post("/api/settings/shopping", async (req, res) => {
  if (!requireDb(res)) return;

  const session = requireUser(req, res);
  if (!session) return;

  const preferredColorways = Array.isArray(req.body?.preferredColorways)
    ? req.body.preferredColorways.slice(0, 20)
    : [];

  const checkoutPreferences =
    req.body?.checkoutPreferences &&
    typeof req.body.checkoutPreferences === "object"
      ? req.body.checkoutPreferences
      : {};

  try {
    const { data: current, error: readError } = await supabase
      .from("customers")
      .select("checkout_preferences")
      .eq("email", session.email)
      .maybeSingle();
    if (readError) throw readError;
    const existing = current?.checkout_preferences && typeof current.checkout_preferences === "object"
      ? current.checkout_preferences : {};
    // Merge customer-editable preferences without erasing server-managed saved payment methods.
    const mergedCheckoutPreferences = { ...existing, ...checkoutPreferences };
    if (Array.isArray(existing.savedPaymentMethods)) {
      mergedCheckoutPreferences.savedPaymentMethods = existing.savedPaymentMethods;
    }
    const { error } = await supabase
      .from("customers")
      .update({
        preferred_colorways: preferredColorways,
        checkout_preferences: mergedCheckoutPreferences
      })
      .eq("email", session.email);

    if (error) throw error;

    return res.json({
      ok: true,
      shopping: {
        preferredColorways,
        checkoutPreferences: mergedCheckoutPreferences
      }
    });
  } catch (e) {
    console.error("[GRIM shopping settings]", e);
    return res.status(500).json({
      error: "Unable to save shopping preferences."
    });
  }
});


// Save notification preferences
app.post("/api/settings/notifications", async (req, res) => {
  if (!requireDb(res)) return;

  const session = requireUser(req, res);
  if (!session) return;

  const settings = {
    notify_orders: req.body?.orders !== false,
    notify_wallet: req.body?.wallet !== false,
    notify_drops: req.body?.drops !== false,
    notify_restocks: req.body?.restocks !== false,
    notify_promotions: req.body?.promotions === true,
    notify_house_of_grim: req.body?.houseOfGrim !== false
  };

  try {
    const { error } = await supabase
      .from("customers")
      .update(settings)
      .eq("email", session.email);

    if (error) throw error;

    return res.json({
      ok: true,
      notifications: {
        orders: settings.notify_orders,
        wallet: settings.notify_wallet,
        drops: settings.notify_drops,
        restocks: settings.notify_restocks,
        promotions: settings.notify_promotions,
        houseOfGrim: settings.notify_house_of_grim
      }
    });
  } catch (e) {
    console.error("[GRIM notification settings]", e);
    return res.status(500).json({
      error: "Unable to save notification preferences."
    });
  }
});


// Save privacy / marketing preference
app.post("/api/settings/privacy", async (req, res) => {
  if (!requireDb(res)) return;

  const session = requireUser(req, res);
  if (!session) return;

  const marketingConsent = req.body?.marketingConsent === true;

  try {
    const { error } = await supabase
      .from("customers")
      .update({
        marketing_consent: marketingConsent
      })
      .eq("email", session.email);

    if (error) throw error;

    return res.json({
      ok: true,
      privacy: {
        marketingConsent
      }
    });
  } catch (e) {
    console.error("[GRIM privacy settings]", e);
    return res.status(500).json({
      error: "Unable to save privacy settings."
    });
  }
});
}

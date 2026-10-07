import bcrypt from "bcryptjs";
import crypto from "crypto";

export function installGrimV7(app,{supabase}){
 const cleanEmail=v=>String(v||"").trim().toLowerCase();
 const clean=(v,n=500)=>String(v||"").trim().slice(0,n);
 const hash=v=>crypto.createHash("sha256").update(String(v)).digest("hex");
 const otp=()=>String(crypto.randomInt(0,1000000)).padStart(6,"0");
 const passwordOK=p=>typeof p==="string"&&p.length>=8&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/[0-9]/.test(p)&&/[^A-Za-z0-9]/.test(p);
 async function sendEmail(to,subject,html){
  if(!process.env.RESEND_API_KEY||!process.env.TWO_FACTOR_FROM_EMAIL) throw new Error("Email delivery is not configured.");
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.TWO_FACTOR_FROM_EMAIL,to:Array.isArray(to)?to:[to],subject,html})});
  if(!r.ok){const detail=await r.text().catch(()=>"");console.error("[GRIM email delivery]",r.status,detail.slice(0,1000));throw new Error("Unable to send email.");}
 }
 app.post("/api/auth/forgot-password",async(req,res)=>{
  if(!supabase) return res.status(503).json({error:"Account services are unavailable."});
  const email=cleanEmail(req.body?.email); const generic={ok:true,message:"If that email belongs to a GRIM account, a reset code has been sent."};
  if(!email) return res.json(generic);
  try{
   const {data:user}=await supabase.from("customers").select("id,email,auth_provider").eq("email",email).maybeSingle();
   if(!user||user.auth_provider==="google") return res.json(generic);
   const code=otp();
   await supabase.from("password_reset_challenges").update({used:true}).eq("customer_id",user.id).eq("used",false);
   const {error}=await supabase.from("password_reset_challenges").insert({customer_id:user.id,code_hash:hash(code),expires_at:new Date(Date.now()+10*60*1000).toISOString(),attempts_remaining:5});
   if(error) throw error;
   await sendEmail(email,"Reset your GRIM password",`<div style="background:#090909;color:#eee;padding:32px;font-family:Arial,sans-serif"><b style="letter-spacing:4px">GRIM</b><h2>RESET YOUR PASSWORD</h2><p>Your one-time reset code is:</p><div style="font-size:34px;letter-spacing:8px;font-weight:800">${code}</div><p style="color:#aaa">Expires in 10 minutes. If you did not request this, ignore this email.</p></div>`);
   return res.json(generic);
  }catch(e){console.error("[GRIM reset request]",e);return res.status(502).json({error:"GRIM could not deliver the reset code right now. Please try again shortly or contact Customer Care."});}
 });
 app.post("/api/auth/reset-password",async(req,res)=>{
  if(!supabase) return res.status(503).json({error:"Account services are unavailable."});
  const email=cleanEmail(req.body?.email),code=clean(req.body?.code,12),password=String(req.body?.newPassword||"");
  if(!/^\d{6}$/.test(code)) return res.status(400).json({error:"Enter the 6-digit reset code."});
  if(!passwordOK(password)) return res.status(400).json({error:"Password needs uppercase, lowercase, number, special character, and 8+ characters."});
  try{
   const {data:user}=await supabase.from("customers").select("id").eq("email",email).maybeSingle(); if(!user) return res.status(400).json({error:"Invalid or expired reset code."});
   const {data:c}=await supabase.from("password_reset_challenges").select("*").eq("customer_id",user.id).eq("used",false).order("created_at",{ascending:false}).limit(1).maybeSingle();
   if(!c||new Date(c.expires_at).getTime()<Date.now()||c.attempts_remaining<=0) return res.status(400).json({error:"Invalid or expired reset code."});
   if(hash(code)!==c.code_hash){await supabase.from("password_reset_challenges").update({attempts_remaining:c.attempts_remaining-1}).eq("id",c.id);return res.status(400).json({error:"Invalid or expired reset code."});}
   const password_hash=await bcrypt.hash(password,12);
   const {error}=await supabase.from("customers").update({password_hash,password_changed_at:new Date().toISOString()}).eq("id",user.id); if(error) throw error;
   await supabase.from("password_reset_challenges").update({used:true,used_at:new Date().toISOString()}).eq("id",c.id);
   return res.json({ok:true,message:"Password reset. You can sign in now."});
  }catch(e){console.error("[GRIM reset]",e);return res.status(500).json({error:"Unable to reset password right now."});}
 });
 // Secure broadcast endpoint for drops, products, restocks, discounts and important notices.
 app.post("/api/admin/customer-email",async(req,res)=>{
  if(!process.env.GRIM_ADMIN_EMAIL_KEY||req.get("x-grim-admin-key")!==process.env.GRIM_ADMIN_EMAIL_KEY) return res.status(401).json({error:"Unauthorized."});
  if(!supabase) return res.status(503).json({error:"Customer database unavailable."});
  const type=clean(req.body?.type,30),subject=clean(req.body?.subject,140),message=clean(req.body?.message,5000);
  if(!subject||!message) return res.status(400).json({error:"Subject and message are required."});
  const column={promotion:"notify_promotions",discount:"notify_promotions",drop:"notify_drops",product:"notify_drops",restock:"notify_restocks",important:"notify_house_of_grim"}[type]||"notify_house_of_grim";
  let q=supabase.from("customers").select("email,marketing_consent").eq(column,true).eq("account_status","active");
  if(["promotion","discount"].includes(type)) q=q.eq("marketing_consent",true);
  const {data,error}=await q; if(error) return res.status(500).json({error:"Unable to load recipients."});
  let sent=0,failed=0;
  for(const u of data||[]){try{await sendEmail(u.email,subject,`<div style="background:#090909;color:#eee;padding:32px;font-family:Arial,sans-serif"><b style="letter-spacing:4px">GRIM</b><h2>${subject.replace(/[<>]/g,"")}</h2><p style="white-space:pre-line">${message.replace(/[<>]/g,"")}</p><p style="color:#888">TIME IS BORROWED. LEGACY IS EARNED.</p></div>`);sent++;}catch{failed++;}}
  res.json({ok:true,sent,failed});
 });
}

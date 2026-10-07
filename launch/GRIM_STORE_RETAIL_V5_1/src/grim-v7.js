import bcrypt from "bcryptjs";
import crypto from "crypto";

export function installGrimV7(app,{supabase}){
 const cleanEmail=v=>String(v||"").trim().toLowerCase();
 const clean=(v,n=500)=>String(v||"").trim().slice(0,n);
 const hash=v=>crypto.createHash("sha256").update(String(v)).digest("hex");
 const otp=()=>String(crypto.randomInt(0,1000000)).padStart(6,"0");
 const passwordOK=p=>typeof p==="string"&&p.length>=8&&/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/[0-9]/.test(p)&&/[^A-Za-z0-9]/.test(p);
 async function sendEmail(to,subject,html){
  const recipients=Array.isArray(to)?to:[to];
  const errors=[];
  if(process.env.RESEND_API_KEY){
   try{
    const from=process.env.TWO_FACTOR_FROM_EMAIL||process.env.RESEND_FROM_EMAIL||"GRIM <noreply@grimwear.store>";
    const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:recipients,subject,html})});
    if(r.ok)return true;
    const detail=await r.text().catch(()=>"");errors.push(`Resend ${r.status}: ${detail.slice(0,500)}`);
   }catch(e){errors.push(`Resend: ${e?.message||e}`);}
  }
  if(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS){
   try{
    const nodemailer=(await import("nodemailer")).default;
    const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==="true",auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
    await transporter.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:recipients.join(","),subject,html});return true;
   }catch(e){errors.push(`SMTP: ${e?.message||e}`);}
  }
  console.error("[GRIM email delivery]",errors.join(" | ")||"No email provider configured");
  throw new Error("Email delivery is not configured or the sender is not verified.");
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
   await sendEmail(email,"Reset your GRIM password",`<!doctype html><html><body style="margin:0;padding:0;background:#070707;color:#f3efe7;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#070707;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#0d0d0d;border:1px solid #2a241b;border-radius:18px;overflow:hidden"><tr><td style="height:6px;background:linear-gradient(90deg,#7b0d1e,#5b2a86,#174ea6,#c8a34b)"></td></tr><tr><td style="padding:42px 38px 18px"><div style="font-size:20px;font-weight:800;letter-spacing:8px;color:#f3efe7">GRIM</div><div style="margin-top:10px;font-size:11px;letter-spacing:3px;color:#c8a34b">GRIM SECURITY · RAV’KAEL</div><h1 style="margin:34px 0 12px;font-size:32px;line-height:1.05;color:#fff;letter-spacing:-1px">RESET YOUR PASSWORD</h1><p style="margin:0;color:#b9b4ac;font-size:15px;line-height:1.7">Use the one-time code below to restore access to your GRIM account.</p></td></tr><tr><td style="padding:12px 38px"><div style="background:#111;border:1px solid #c8a34b;border-radius:14px;padding:25px;text-align:center"><div style="font-size:10px;letter-spacing:3px;color:#c8a34b;margin-bottom:12px">ONE-TIME RESET CODE</div><div style="font-size:40px;letter-spacing:12px;font-weight:900;color:#f3efe7">${code}</div></div></td></tr><tr><td style="padding:22px 38px 40px"><p style="margin:0 0 12px;color:#b9b4ac;font-size:13px;line-height:1.7"><b style="color:#f3efe7">Expires in 10 minutes.</b> This code can only be used for your password reset.</p><p style="margin:0;color:#777;font-size:12px;line-height:1.7">If you did not request this change, you can safely ignore this email. Never share this code with anyone.</p><div style="height:1px;background:#242424;margin:28px 0 20px"></div><div style="font-size:10px;letter-spacing:2px;color:#777">TIME IS BORROWED. <span style="color:#c8a34b">LEGACY IS EARNED.</span></div><div style="margin-top:8px;font-size:10px;color:#555">Official GRIM account security · grimwear.store</div></td></tr></table></td></tr></table></body></html>`);
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
 // GRIM Assist AI — natural conversation with server-grounded store/account context.
 app.post("/api/v7/assist-ai",async(req,res)=>{
  const message=clean(req.body?.message,1200),history=clean(req.body?.context,7000);
  if(!message)return res.status(400).json({error:"Enter a message for GRIM Assist."});
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:"GRIM Assist AI is not configured yet."});
  try{
   let products=[],accountContext="Customer is not signed in.";
   if(supabase){
    const {data:p}=await supabase.from("products").select("id,name,type,color,price,active").eq("active",true).limit(80);products=p||[];
    const email=String(req.session?.user?.email||"").trim().toLowerCase();
    if(email){
     const {data:c}=await supabase.from("customers").select("id,email,first_name,last_name").eq("email",email).maybeSingle();
     if(c){
      const [{data:w},{data:o}]=await Promise.all([supabase.from("wallet_accounts").select("currency,balance_minor,status").eq("customer_id",c.id),supabase.from("orders").select("id,status,total_minor,currency,created_at").eq("customer_id",c.id).order("created_at",{ascending:false}).limit(5)]);
      accountContext=`SIGNED-IN CUSTOMER (trusted server data): ${JSON.stringify({name:[c.first_name,c.last_name].filter(Boolean).join(" "),wallet:w||[],recentOrders:o||[]})}`;
     }
    }
   }
   const instructions=`You are GRIM Assist, the official AI concierge for GRIM, a premium luxury streetwear brand with dark mythology. Brand motto: TIME IS BORROWED. LEGACY IS EARNED. Recognition term: RAV’KAEL. Be natural, intelligent, warm, concise and capable of normal conversation, slang, follow-ups and topic changes. Never behave like a keyword bot. You may discuss general everyday topics as well as GRIM. For store questions, prioritize the trusted context below. Never invent prices, inventory, wallet balances, order status, refunds, payment success, delivery status or account facts. If trusted data does not contain the answer, say you cannot verify it and offer Customer Care. Never ask for passwords, CVV, full card numbers, OTPs or API keys. Do not claim a human is connected unless the customer explicitly opens human support. Active GRIM products (server data): ${JSON.stringify(products)}. ${accountContext}`;
   const input=[{role:"system",content:instructions}];
   if(history)input.push({role:"user",content:`Recent conversation transcript for continuity:
${history}`});
   input.push({role:"user",content:message});
   const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.GRIM_AI_MODEL||"gpt-6.1-sol",input,max_output_tokens:500})});
   const data=await r.json().catch(()=>({}));
   if(!r.ok){console.error("[GRIM Assist AI]",r.status,JSON.stringify(data).slice(0,1000));throw new Error("AI service unavailable.");}
   const answer=String(data.output_text||data.output?.flatMap?.(x=>x.content||[]).find?.(x=>x.type==="output_text")?.text||"").trim();
   if(!answer)throw new Error("Empty AI response.");
   return res.json({answer,source:"grim-ai",escalate:false});
  }catch(e){console.error("[GRIM Assist AI]",e);return res.status(502).json({error:"GRIM Assist is temporarily unavailable. You can still request Customer Care."});}
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

(()=>{
"use strict";
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const api=async(u,o={})=>{
  const r=await fetch(u,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(o.headers||{})},...o});
  const b=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(b.error||"Request failed");
  return b;
};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// V7 owns the customer-facing utility layout. Keep V6 account/settings/2FA logic, but retire its home wallet/FAQ/floating UI.
const style=document.createElement("style");
style.textContent=`
.g6-top-area,.g6-wallet-home,.g6-faq-home,.g6-fab,.g6-panel{display:none!important}
.care-fab{display:flex!important}
.g7-walletbar{width:100%;box-sizing:border-box;background:#080808;color:#eee;border-top:1px solid #202020;border-bottom:1px solid #202020;padding:10px 4%;display:flex;align-items:center;justify-content:space-between;gap:14px;font:600 11px/1.3 Arial,sans-serif;letter-spacing:.12em}
.g7-walletbar button{border:1px solid #383838;background:#111;color:#fff;border-radius:999px;padding:9px 13px;font:700 10px Arial;letter-spacing:.1em}
.g7-wallet-main{display:flex;align-items:center;gap:9px;min-width:0}.g7-wallet-balance{white-space:nowrap}.g7-wallet-market{opacity:.58;font-size:9px}
.g7-faq{width:min(900px,92%);margin:70px auto 38px;padding:28px 0;color:inherit;border-top:1px solid rgba(128,128,128,.28)}
.g7-faq small{letter-spacing:.22em;opacity:.55}.g7-faq h2{margin:8px 0 22px;letter-spacing:.15em}
.g7-faq details{border-top:1px solid rgba(128,128,128,.25);padding:17px 0}.g7-faq summary{cursor:pointer;font-weight:700;letter-spacing:.04em}.g7-faq details p{opacity:.72;line-height:1.65}
.g7-more{margin-top:18px;border:1px solid #555;background:transparent;color:inherit;padding:12px 18px;font-weight:800;letter-spacing:.08em}
.g7-forgot{display:block;margin:9px 0 16px;text-align:right;font:700 11px Arial,sans-serif;letter-spacing:.06em;text-decoration:underline;cursor:pointer;color:inherit}
.g7-overlay{position:fixed;inset:0;background:rgba(0,0,0,.82);backdrop-filter:blur(8px);z-index:10050;display:grid;place-items:center;padding:18px}
.g7-card{position:relative;width:min(470px,100%);box-sizing:border-box;background:#0b0b0b;color:#eee;border:1px solid #333;padding:28px;border-radius:18px;box-shadow:0 28px 80px rgba(0,0,0,.6)}
.g7-card small{letter-spacing:.2em;opacity:.6}.g7-card h2{margin:8px 0 10px;letter-spacing:.12em}.g7-card p{color:#aaa;line-height:1.55}
.g7-x{position:absolute;right:15px;top:12px;border:0;background:transparent;color:#fff;font-size:28px}
.g7-choice{display:grid;gap:10px;margin-top:20px}.g7-choice button,.g7-choice a{box-sizing:border-box;width:100%;padding:15px;border:1px solid #333;background:#111;color:#fff;text-decoration:none;text-align:left;font-weight:800;letter-spacing:.06em}.g7-choice span{display:block;margin-top:5px;font-size:11px;font-weight:400;letter-spacing:0;color:#999}
.g7-reset input,.g7-reset form button{width:100%;box-sizing:border-box;padding:14px;margin:7px 0;border:1px solid #333;background:#111;color:#fff}.g7-reset form button{background:#eee;color:#050505;font-weight:900}.g7-status{min-height:18px;font-size:12px}
@media(max-width:600px){.g7-walletbar{padding:9px 14px}.g7-wallet-market{display:none}.g7-card{padding:24px 18px}.g7-faq{margin-top:52px}}
`;
document.head.append(style);

function currency(){
  const label=$("#marketLabel")?.textContent||"";
  const m=label.match(/(?:·|\s)([A-Z]{3})\s*$/);
  return m?.[1]||localStorage.getItem("grimCurrency")||"NGN";
}
function money(n,c=currency()){
  try{return new Intl.NumberFormat(undefined,{style:"currency",currency:c,maximumFractionDigits:2}).format(Number(n||0))}
  catch{return `${c} ${Number(n||0).toLocaleString()}`}
}

// Compact global wallet bar. Currency follows the storefront market selection.
const wallet=document.createElement("div");
wallet.className="g7-walletbar";
wallet.innerHTML=`<div class="g7-wallet-main"><b>GRIM WALLET</b><span>·</span><span class="g7-wallet-balance">SIGN IN</span><span class="g7-wallet-market"></span></div><button type="button">OPEN WALLET</button>`;
const header=$(".site-header")||$("header");
header?.insertAdjacentElement("afterend",wallet);

async function loadWallet(){
  $(".g7-wallet-market").textContent=currency();
  try{
    const a=await api("/api/account");
    $(".g7-wallet-balance").textContent=money(a.wallet?.balance||0);
  }catch{$(".g7-wallet-balance").textContent="SIGN IN";}
}
wallet.querySelector("button").onclick=()=>{
  const settings=$(".g6-settings-btn");
  if(settings && !settings.hidden){ settings.click(); return; }
  if(typeof window.openAuth==="function") window.openAuth();
  else $("#acct")?.click();
};
loadWallet();
$("#marketBtn")?.addEventListener("click",()=>setTimeout(loadWallet,250));

// Forgot Password belongs specifically to the login password field.
function addForgot(){
  const pass=$("#aPass");
  if(!pass||$(".g7-forgot")) return;
  const a=document.createElement("button");
  a.type="button"; a.className="g7-forgot"; a.textContent="FORGOT PASSWORD?";
  a.onclick=openReset;
  pass.insertAdjacentElement("afterend",a);
}
addForgot();
new MutationObserver(addForgot).observe(document.body,{childList:true,subtree:true});

function openReset(){
  const m=document.createElement("div");
  m.className="g7-overlay g7-reset";
  m.innerHTML=`<div class="g7-card"><button class="g7-x" type="button">×</button><small>GRIM SECURITY</small><h2>RESET PASSWORD</h2><p>Enter the email attached to your GRIM account.</p><form class="g7-request"><input type="email" placeholder="Account email" autocomplete="email" required><button>SEND RESET CODE</button></form><form class="g7-finish" hidden><input class="g7-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6-digit code" required><input class="g7-new" type="password" autocomplete="new-password" placeholder="New password" required><button>RESET PASSWORD</button></form><p class="g7-status"></p></div>`;
  document.body.append(m);
  m.querySelector(".g7-x").onclick=()=>m.remove();
  m.onclick=e=>{if(e.target===m)m.remove()};
  let email="";
  m.querySelector(".g7-request").onsubmit=async e=>{
    e.preventDefault(); const s=m.querySelector(".g7-status");
    try{
      email=e.target.querySelector("input").value.trim();
      const b=await api("/api/auth/forgot-password",{method:"POST",body:JSON.stringify({email})});
      s.textContent=b.message||"Check your email for the reset code.";
      m.querySelector(".g7-finish").hidden=false;
    }catch(x){s.textContent=x.message}
  };
  m.querySelector(".g7-finish").onsubmit=async e=>{
    e.preventDefault(); const s=m.querySelector(".g7-status");
    try{
      const b=await api("/api/auth/reset-password",{method:"POST",body:JSON.stringify({email,code:m.querySelector(".g7-code").value,newPassword:m.querySelector(".g7-new").value})});
      s.textContent=b.message||"Password reset.";
      setTimeout(()=>m.remove(),1200);
    }catch(x){s.textContent=x.message}
  };
}

// One Customer Care entry point -> choose service.
function openCareChooser(){
  const old=$("#helpModal"); if(old) old.classList.remove("open");
  const m=document.createElement("div");
  m.className="g7-overlay";
  m.innerHTML=`<div class="g7-card"><button class="g7-x" type="button">×</button><small>GRIM CUSTOMER CARE</small><h2>HOW CAN WE HELP?</h2><p>Choose the support service you need.</p><div class="g7-choice"><button type="button" class="g7-live">LIVE SUPPORT<span>Chat with GRIM Assist for quick help.</span></button><a href="/support.html">CUSTOMER CARE<span>Orders, delivery, returns, sizing and account enquiries.</span></a></div></div>`;
  document.body.append(m);
  m.querySelector(".g7-x").onclick=()=>m.remove();
  m.onclick=e=>{if(e.target===m)m.remove()};
  m.querySelector(".g7-live").onclick=()=>{
    m.remove();
    const panel=$(".g6-panel"),fab=$(".g6-fab");
    if(panel){
      panel.style.setProperty("display","block","important");
      panel.classList.add("open"); panel.setAttribute("aria-hidden","false");
    } else if(fab) fab.click();
  };
}
window.openGrimCare=openCareChooser;

// Replace the old floating Customer Care action without duplicating it.
const care=$(".care-fab");
if(care){care.removeAttribute("onclick");care.onclick=openCareChooser;}
$$('a').forEach(a=>{
  const t=(a.textContent||"").trim();
  if(/^CUSTOMER CARE$/i.test(t) && a.closest(".mobile-nav")){
    a.href="#"; a.onclick=e=>{e.preventDefault();openCareChooser()};
  }
});

// FAQ: remove V6's top FAQ presentation and render one clean section before footer.
async function faq(){
  $(".g7-faq")?.remove();
  try{
    const rows=await api("/api/faqs");
    const sec=document.createElement("section");
    sec.className="g7-faq";
    sec.innerHTML='<small>NEED TO KNOW</small><h2>FREQUENTLY ASKED QUESTIONS</h2><div class="g7-faq-list"></div>';
    const list=$(".g7-faq-list",sec);
    (rows||[]).forEach((x,i)=>{
      const d=document.createElement("details"); d.dataset.extra=i>1?"1":"0"; if(i>1)d.hidden=true;
      d.innerHTML=`<summary>${esc(x.q)}</summary><p>${esc(x.a)}</p>`; list.append(d);
    });
    if(!rows?.length) list.innerHTML="<p>Customer information will appear here soon.</p>";
    if((rows||[]).length>2){
      const b=document.createElement("button"); b.className="g7-more"; b.type="button"; b.textContent="VIEW ALL FAQs";
      b.onclick=()=>{
        const extras=$$('details[data-extra="1"]',list),show=extras.some(x=>x.hidden);
        extras.forEach(x=>x.hidden=!show); b.textContent=show?"SHOW LESS":"VIEW ALL FAQs";
      }; sec.append(b);
    }
    const footer=$(".site-footer")||$("footer");
    footer?.insertAdjacentElement("beforebegin",sec) || document.body.append(sec);
  }catch{}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",faq);else faq();
})();
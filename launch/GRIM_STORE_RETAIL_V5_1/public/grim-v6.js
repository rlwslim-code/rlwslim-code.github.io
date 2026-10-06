(() => {
const $=(s,r=document)=>r.querySelector(s);
const fmt=n=>"₦"+Number(n||0).toLocaleString();
const api=async(url,opt={})=>{
  const r=await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(opt.headers||{})},...opt});
  const b=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(b.error||"Request failed");
  return b;
};
const css=document.createElement("link"); css.rel="stylesheet"; css.href="/grim-v6.css?v=6"; document.head.append(css);

const shell=document.createElement("div");
shell.innerHTML=`
<button class="g6-fab" aria-label="Open GRIM Assist">G</button>
<section class="g6-panel" aria-hidden="true">
 <header><div><b>GRIM ASSIST</b><small>Customer Care</small></div><button class="g6-close">×</button></header>
 <div class="g6-tabs"><button data-tab="assist" class="on">ASSIST</button><button data-tab="wallet">WALLET</button><button data-tab="faq">FAQ</button></div>
 <div class="g6-body" data-view="assist">
  <div class="g6-messages"><div class="bot">RAV’KAEL. How can I help you today?</div></div>
  <form class="g6-chat"><input maxlength="800" placeholder="Ask about orders, sizing, wallet…" required><button>SEND</button></form>
 </div>
 <div class="g6-body hide" data-view="wallet">
   <div class="g6-wallet"><small>GRIM WALLET</small><strong class="g6-balance">—</strong><p class="g6-wallet-note">Sign in to view your balance.</p>
   <form class="g6-fund"><input type="number" min="1000" max="1000000" step="100" placeholder="Amount in ₦"><button>FUND WALLET</button></form>
   <div class="g6-txs"></div></div>
 </div>
 <div class="g6-body hide" data-view="faq"><div class="g6-faqs">Loading FAQs…</div></div>
</section>`;
document.body.append(...shell.children);
const panel=$(".g6-panel"), fab=$(".g6-fab"), close=$(".g6-close");
fab.onclick=()=>{panel.classList.add("open");panel.setAttribute("aria-hidden","false");loadAccount();};
close.onclick=()=>{panel.classList.remove("open");panel.setAttribute("aria-hidden","true");};
document.querySelectorAll(".g6-tabs button").forEach(b=>b.onclick=()=>{
 document.querySelectorAll(".g6-tabs button").forEach(x=>x.classList.toggle("on",x===b));
 document.querySelectorAll(".g6-body").forEach(v=>v.classList.toggle("hide",v.dataset.view!==b.dataset.tab));
 if(b.dataset.tab==="faq") loadFaq();
 if(b.dataset.tab==="wallet") loadAccount();
});
const messages=$(".g6-messages");
$(".g6-chat").onsubmit=async e=>{
 e.preventDefault(); const input=$(".g6-chat input"), msg=input.value.trim(); if(!msg)return;
 messages.insertAdjacentHTML("beforeend",`<div class="me"></div>`); messages.lastElementChild.textContent=msg; input.value="";
 try{const b=await api("/api/assist",{method:"POST",body:JSON.stringify({message:msg})});
 messages.insertAdjacentHTML("beforeend",`<div class="bot"></div>`);messages.lastElementChild.textContent=b.answer;
 if(b.escalate){const a=document.createElement("a");a.href="/support.html";a.textContent="Open Customer Care →";a.className="g6-support";messages.append(a);}
 }catch(err){messages.insertAdjacentHTML("beforeend",`<div class="bot">Customer Care is temporarily unavailable.</div>`);}
 messages.scrollTop=messages.scrollHeight;
};
let faqLoaded=false;
async function loadFaq(){
 if(faqLoaded)return;
 try{const rows=await api("/api/faqs"); $(".g6-faqs").innerHTML=rows.map(x=>`<details><summary></summary><p></p></details>`).join("");
 [...$(".g6-faqs").children].forEach((d,i)=>{d.querySelector("summary").textContent=rows[i].q;d.querySelector("p").textContent=rows[i].a;});faqLoaded=true;
 }catch{$(".g6-faqs").textContent="FAQs are temporarily unavailable."}
}
async function loadAccount(){
 try{
  const a=await api("/api/account");
  $(".g6-balance").textContent=fmt(a.wallet.balance);
  $(".g6-wallet-note").textContent=`Signed in as ${a.user.email}`;
  $(".g6-txs").innerHTML=(a.transactions||[]).slice(0,8).map(t=>`<div class="g6-tx"><span>${t.type.toUpperCase()}</span><b>${t.type==="debit"?"−":"+"}${fmt(t.amount)}</b></div>`).join("")||"<p>No wallet transactions yet.</p>";
 }catch{ $(".g6-balance").textContent="—"; $(".g6-wallet-note").textContent="Sign in to use GRIM Wallet."; }
}
$(".g6-fund").onsubmit=async e=>{
 e.preventDefault();const amount=Number($(".g6-fund input").value);
 try{const b=await api("/api/wallet/fund/initialize",{method:"POST",body:JSON.stringify({amount})});location.href=b.authorizationUrl;}
 catch(err){alert(err.message);}
};
const p=new URLSearchParams(location.search);
if(p.get("wallet")==="verify"&&p.get("reference")){
 api("/api/wallet/fund/verify",{method:"POST",body:JSON.stringify({reference:p.get("reference")})})
 .then(()=>{history.replaceState({}, "", location.pathname);panel.classList.add("open");document.querySelector('[data-tab="wallet"]').click();})
 .catch(e=>alert(e.message));
}

// GRIM email 2FA UI. Existing login forms need no rewrite: intercept successful
// /api/login responses that request a second factor.
const originalFetch=window.fetch.bind(window);
window.fetch=async function(input,init){
 const response=await originalFetch(input,init);
 try{
  const url=typeof input==="string"?input:(input?.url||"");
  if(url.includes("/api/login") && response.ok){
   const clone=response.clone(), body=await clone.json();
   if(body?.requiresTwoFactor) setTimeout(()=>open2FA(body.emailHint),0);
  }
 }catch{}
 return response;
};
function open2FA(hint){
 let modal=document.querySelector(".g6-2fa");
 if(!modal){
  modal=document.createElement("div");modal.className="g6-2fa";
  modal.innerHTML=`<div class="g6-2fa-card"><button class="g6-2fa-x">×</button><small>GRIM SECURITY</small><h2>VERIFY SIGN-IN</h2><p>We sent a 6-digit code to <b class="g6-2fa-hint"></b>.</p><form><input inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" required><button>VERIFY</button></form><button class="g6-resend">RESEND CODE</button><p class="g6-2fa-status"></p></div>`;
  document.body.append(modal);
  modal.querySelector(".g6-2fa-x").onclick=()=>modal.remove();
  modal.querySelector("form").onsubmit=async e=>{
   e.preventDefault();const status=modal.querySelector(".g6-2fa-status");
   try{
    const b=await api("/api/auth/2fa/verify",{method:"POST",body:JSON.stringify({code:modal.querySelector("input").value})});
    status.textContent="Verified. Welcome to GRIM."; setTimeout(()=>location.reload(),500);
   }catch(err){status.textContent=err.message;}
  };
  modal.querySelector(".g6-resend").onclick=async()=>{
   const status=modal.querySelector(".g6-2fa-status");
   try{await api("/api/auth/2fa/resend",{method:"POST",body:"{}"});status.textContent="A new code has been sent.";}
   catch(err){status.textContent=err.message;}
  };
 }
 modal.querySelector(".g6-2fa-hint").textContent=hint||"your email";
}

})();
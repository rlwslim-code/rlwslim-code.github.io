(()=>{
"use strict";
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const api=async(u,o={})=>{const r=await fetch(u,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(o.headers||{})},...o});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||"Request failed");return b};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const css=document.createElement("style");
css.textContent=`
:root{--obsidian:#070707;--veil:#f3efe7;--bloodline:#7b0d1e;--abyss:#174ea6;--void:#5b2a86;--rose:#c43d72;--gold:#c8a34b;--grimline:rgba(255,255,255,.16)}
.g6-top-area,.g6-wallet-home,.g6-faq-home,.g6-fab,.g6-panel{display:none!important}
body{background:var(--obsidian)}
.g7-spectrum{height:3px;background:linear-gradient(90deg,var(--bloodline),var(--rose),var(--void),var(--abyss),var(--gold),var(--veil))}
.g7-walletbar{background:#090909;color:var(--veil);border-block:1px solid var(--grimline);padding:10px 4%;display:flex;justify-content:space-between;align-items:center;gap:12px;font:700 11px Arial;letter-spacing:.13em}
.g7-walletbar button{border:1px solid var(--gold);background:#101010;color:var(--veil);border-radius:999px;padding:9px 13px;font:700 10px Arial;letter-spacing:.1em}.g7-wallet-market{opacity:.6;font-size:9px}
.g7-faq{width:min(900px,92%);box-sizing:border-box;margin:58px auto 28px;padding:30px 24px;background:linear-gradient(145deg,#111,#090909);color:var(--veil);border:1px solid #333;border-top:3px solid var(--gold);border-radius:18px;box-shadow:0 20px 60px #0008}
.g7-faq small,.g7-card small{letter-spacing:.22em;color:var(--gold)}.g7-faq h2{font-size:25px;letter-spacing:.13em;margin:8px 0 22px}.g7-faq details{border-top:1px solid #343434;padding:17px 0}.g7-faq summary{font-weight:800;cursor:pointer;color:#fff}.g7-faq p{color:#c8c8c8;line-height:1.6}.g7-more{margin-top:18px;border:1px solid var(--gold);background:#111;color:#fff;padding:12px 18px;font-weight:800;letter-spacing:.08em}
.g7-forgot{display:none;margin:9px 0 15px auto;border:0;background:transparent;color:#111;text-decoration:underline;font:800 11px Arial;letter-spacing:.04em}
.g7-overlay{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.88);backdrop-filter:blur(8px);display:grid;place-items:center;padding:18px;box-sizing:border-box}
.g7-card{position:relative;width:min(500px,100%);max-height:88vh;overflow:auto;box-sizing:border-box;background:#0b0b0b;color:var(--veil);border:1px solid #333;border-top:3px solid var(--gold);padding:28px;border-radius:18px;box-shadow:0 28px 90px #000}
.g7-card:before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,var(--bloodline),var(--rose),var(--void),var(--abyss),var(--gold))}
.g7-x{position:absolute;right:14px;top:10px;border:0;background:transparent;color:#fff;font-size:29px}.g7-card h2{letter-spacing:.12em;margin:8px 0}.g7-card p{color:#aaa;line-height:1.55}
.g7-choice{display:grid;gap:10px;margin-top:20px}.g7-choice button,.g7-choice a,.g7-action{width:100%;box-sizing:border-box;padding:15px;border:1px solid #383838;background:#111;color:#fff;text-decoration:none;text-align:left;font-weight:800;letter-spacing:.06em}.g7-choice button:first-child{border-left:3px solid var(--abyss)}.g7-choice a{border-left:3px solid var(--rose)}.g7-choice span{display:block;margin-top:5px;color:#999;font-size:11px;font-weight:400;letter-spacing:0}
.g7-chat-card{height:min(720px,88vh);display:flex;flex-direction:column;overflow:hidden}.g7-chat-head{padding-bottom:15px;border-bottom:1px solid #292929}.g7-back{border:0;background:transparent;color:var(--gold);padding:0 0 9px;font-weight:800;letter-spacing:.08em}.g7-messages{flex:1;overflow:auto;padding:16px 0;display:flex;flex-direction:column;gap:10px}.g7-msg{max-width:86%;padding:13px 15px;border-radius:16px;line-height:1.45}.g7-bot{align-self:flex-start;background:#171717;border:1px solid #2c2c2c}.g7-me{align-self:flex-end;background:linear-gradient(135deg,var(--bloodline),#4d0c18)}.g7-chat-form{display:flex;gap:8px;border-top:1px solid #292929;padding-top:14px}.g7-chat-form input{flex:1;min-width:0;background:#111;border:1px solid #333;color:#fff;padding:14px;border-radius:12px}.g7-chat-form button{background:var(--veil);color:#080808;border:0;border-radius:12px;padding:0 18px;font-weight:900}.g7-human{margin:2px 0 8px;border:1px solid var(--gold);background:#111;color:#fff;padding:11px 13px;font-weight:800;align-self:flex-start}
.g7-reset input,.g7-reset form button,.g7-human-form input,.g7-human-form textarea,.g7-human-form button{width:100%;box-sizing:border-box;padding:13px;margin:6px 0;border:1px solid #333;background:#111;color:#fff}.g7-reset form button,.g7-human-form button{background:var(--veil);color:#080808;font-weight:900}.g7-status{font-size:12px;min-height:18px}
@media(max-width:600px){.g7-walletbar{padding:9px 14px}.g7-wallet-market{display:none}.g7-card{padding:23px 18px}.g7-faq{margin-top:42px;padding:25px 18px}}
`;
document.head.append(css);

function currency(){const t=$("#marketLabel")?.textContent||"";return t.match(/(?:·|\s)([A-Z]{3})\s*$/)?.[1]||localStorage.getItem("grimCurrency")||"USD"}
function money(n,c){try{return new Intl.NumberFormat(undefined,{style:"currency",currency:c||"USD"}).format(Number(n||0))}catch{return `${c||"USD"} ${Number(n||0).toLocaleString()}`}}
function mountTop(){
 if($(".g7-walletbar"))return;
 const spectrum=document.createElement("div");spectrum.className="g7-spectrum";
 const bar=document.createElement("div");bar.className="g7-walletbar";bar.innerHTML='<div><b>GRIM WALLET</b> · <span class="g7-wallet-balance">SIGN IN</span> <span class="g7-wallet-market"></span></div><button type="button">OPEN WALLET</button>';
 const h=$("header"); if(h){h.insertAdjacentElement("afterend",bar);bar.insertAdjacentElement("beforebegin",spectrum)}else document.body.prepend(spectrum,bar);
 bar.querySelector("button").onclick=()=>{const s=$(".g6-settings-btn");if(s&&!s.hidden)s.click();else if(typeof openAuth==="function")openAuth();else $("#acct")?.click()};
 loadWallet();
}
async function loadWallet(){const c=currency();$(".g7-wallet-market")&&( $(".g7-wallet-market").textContent=c );try{const a=await api("/api/account");const real=a.wallet?.currency||c;$(".g7-wallet-balance").textContent=money(a.wallet?.balance||0,real)}catch{$(".g7-wallet-balance")&&($(".g7-wallet-balance").textContent="SIGN IN")}}

function loginMode(){
 const create=$("#aFirst")||$("#aLast")||$("#aPhone");
 return !(create && create.offsetParent!==null);
}
function addForgot(){
 const pass=$("#aPass");if(!pass)return;
 let b=$(".g7-forgot");
 if(!b){b=document.createElement("button");b.type="button";b.className="g7-forgot";b.textContent="FORGOT PASSWORD?";b.onclick=openReset;pass.insertAdjacentElement("afterend",b)}
 b.style.display=loginMode()?"block":"none";
}
function watchAuth(){addForgot();const root=$("#authModal")||document.body;new MutationObserver(addForgot).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:["class","style","hidden"]});$$("button,a",root).forEach(x=>x.addEventListener("click",()=>setTimeout(addForgot,30)))}

function openReset(){const m=document.createElement("div");m.className="g7-overlay g7-reset";m.innerHTML='<div class="g7-card"><button class="g7-x">×</button><small>GRIM SECURITY</small><h2>RESET PASSWORD</h2><p>Enter the email attached to your GRIM account.</p><form class="rq"><input type="email" placeholder="Account email" required><button>SEND RESET CODE</button></form><form class="rf" hidden><input class="code" inputmode="numeric" maxlength="6" placeholder="6-digit code" required><input class="np" type="password" placeholder="New password" required><button>RESET PASSWORD</button></form><p class="g7-status"></p></div>';document.body.append(m);m.querySelector(".g7-x").onclick=()=>m.remove();let email="";
 m.querySelector(".rq").onsubmit=async e=>{e.preventDefault();const s=m.querySelector(".g7-status");try{email=e.target.querySelector("input").value.trim();const b=await api("/api/auth/forgot-password",{method:"POST",body:JSON.stringify({email})});s.textContent=b.message||"Check your email.";m.querySelector(".rf").hidden=false}catch(x){s.textContent=x.message}};
 m.querySelector(".rf").onsubmit=async e=>{e.preventDefault();const s=m.querySelector(".g7-status");try{const b=await api("/api/auth/reset-password",{method:"POST",body:JSON.stringify({email,code:m.querySelector(".code").value,newPassword:m.querySelector(".np").value})});s.textContent=b.message||"Password reset.";setTimeout(()=>m.remove(),1300)}catch(x){s.textContent=x.message}};
}

function careChooser(){closeG7();const m=document.createElement("div");m.className="g7-overlay g7-care";m.innerHTML='<div class="g7-card"><button class="g7-x">×</button><small>GRIM CUSTOMER CARE</small><h2>HOW CAN WE HELP?</h2><p>Choose the support service you need.</p><div class="g7-choice"><button class="live">LIVE SUPPORT<span>Talk with GRIM Assist now.</span></button><a href="/support.html">CUSTOMER CARE<span>Orders, delivery, returns, sizing and account enquiries.</span></a></div></div>';document.body.append(m);m.querySelector(".g7-x").onclick=closeG7;m.querySelector(".live").onclick=openChat}
function closeG7(){$$(".g7-overlay").forEach(x=>x.remove())}
window.openGrimCare=careChooser;

const intents=[
 [/^(hi|hey|hello|hiya|yo|good (morning|afternoon|evening))[\s!👋.]*$/i,"RAV’KAEL 🖤 Welcome to GRIM. It’s good to have you here. How has your shopping experience been, and how may I help you today?"],
 [/(thank|thanks|appreciate)/i,"Always. RAV’KAEL 🖤 Is there anything else I can help you with?"],
 [/(hoodie|shirt|tee|top|clothes|product|collection|shop)/i,"I can help you find the right GRIM piece. Tell me what you’re looking for—product type, size, or colorway—and I’ll guide you."],
 [/(size|sizing|fit)/i,"Available sizes are shown on each product. Tell me which GRIM piece you’re considering and the fit you prefer, and I’ll guide you. For an exact product issue, Customer Care can also confirm before you order."],
 [/(deliver|delivery|shipping|ship)/i,"I can help with delivery. Tell me the destination country and whether you’re asking about a new order or one already placed."],
 [/(return|exchange|refund)/i,"Returns and exchanges depend on the item, condition and fulfillment stage. If you already ordered, I can bring in Customer Care and pass your issue along."],
 [/(wallet|balance|fund)/i,"GRIM Wallet is your store balance. Your displayed currency follows the supported wallet/payment currency for your account and market. You can still use normal checkout where available."],
 [/(payment|charged|charge|paystack|card|money)/i,"For payment questions I can explain the process, but if you were charged or a payment is missing, I should bring in a human agent so nothing is guessed."],
 [/(order|tracking|track)/i,"If you’re signed in, your Account Center shows recent orders. If an order is missing, delayed, or incorrect, I can request a human agent for you."],
 [/(rav.?kael|ravkael)/i,"RAV’KAEL is how the House recognizes its own—a GRIM greeting and part of the language of the brand. TIME IS BORROWED. LEGACY IS EARNED."],
 [/(human|person|agent|real (help|support)|admin|customer care)/i,"Of course. I can send a request to GRIM Customer Care and pass along the context so you don’t have to start over."]
];
function localReply(q){for(const [r,a] of intents)if(r.test(q))return a;return null}
function needsHuman(q){return /(human|person|agent|admin|customer care|charged|payment.*(missing|failed|problem)|missing order|wrong order|account.*(locked|problem))/i.test(q)}

function openChat(){closeG7();const m=document.createElement("div");m.className="g7-overlay";m.innerHTML='<div class="g7-card g7-chat-card"><div class="g7-chat-head"><button class="g7-back">← BACK TO CUSTOMER CARE</button><button class="g7-x">×</button><small>GRIM ASSIST</small><h2>LIVE SUPPORT</h2></div><div class="g7-messages"><div class="g7-msg g7-bot">RAV’KAEL 🖤 Welcome to GRIM. How may I help you today?</div></div><form class="g7-chat-form"><input maxlength="800" placeholder="Message GRIM Assist…" required><button>SEND</button></form></div>';document.body.append(m);
 m.querySelector(".g7-x").onclick=closeG7;m.querySelector(".g7-back").onclick=careChooser;const msgs=m.querySelector(".g7-messages"),form=m.querySelector("form");
 const say=(t,who="bot")=>{const d=document.createElement("div");d.className=`g7-msg g7-${who}`;d.textContent=t;msgs.append(d);msgs.scrollTop=msgs.scrollHeight};
 const humanBtn=()=>{if(msgs.querySelector(".g7-human"))return;const b=document.createElement("button");b.className="g7-human";b.textContent="REQUEST HUMAN SUPPORT";b.onclick=()=>humanRequest(msgs,say);msgs.append(b);msgs.scrollTop=msgs.scrollHeight};
 form.onsubmit=async e=>{e.preventDefault();const inp=form.querySelector("input"),q=inp.value.trim();if(!q)return;say(q,"me");inp.value="";let a=localReply(q);
   if(a){say(a);if(needsHuman(q))humanBtn();return}
   try{const b=await api("/api/assist",{method:"POST",body:JSON.stringify({message:q})});say(b.answer||"I can help with that.");if(b.escalate)humanBtn()}
   catch{say("I’m having trouble reaching store information right now. I can still request GRIM Customer Care for you.");humanBtn()}
 };
}
async function humanRequest(msgs,say){
 const old=msgs.querySelector(".g7-human");old?.remove();
 let account=null;try{account=await api("/api/account")}catch{}
 const wrap=document.createElement("form");wrap.className="g7-human-form";
 wrap.innerHTML=`<input name="name" placeholder="Your name" value="${esc(account?.user?.name||"")}" required><input name="email" type="email" placeholder="Email" value="${esc(account?.user?.email||"")}" required><input name="order" placeholder="Order reference (optional)"><textarea name="message" placeholder="Briefly tell the agent what you need help with" required></textarea><button>SEND TO GRIM CUSTOMER CARE</button><p class="g7-status"></p>`;
 msgs.append(wrap);msgs.scrollTop=msgs.scrollHeight;
 wrap.onsubmit=async e=>{e.preventDefault();const f=new FormData(wrap),s=wrap.querySelector(".g7-status");try{const b=await api("/api/support",{method:"POST",body:JSON.stringify({topic:"Live support escalation",name:f.get("name"),email:f.get("email"),order:f.get("order"),message:f.get("message")})});wrap.remove();say(`Your request has reached the House. GRIM Customer Care has been notified${b.ticketId?` — ticket ${b.ticketId}`:""}. You can continue here while you wait.`)}catch(x){s.textContent=x.message}};
}

async function faq(){try{const rows=await api("/api/faqs");$(".g7-faq")?.remove();const s=document.createElement("section");s.className="g7-faq";s.innerHTML='<small>THE HOUSE ANSWERS</small><h2>NEED TO KNOW</h2><div class="g7-faq-list"></div>';const l=s.querySelector(".g7-faq-list");(rows||[]).forEach((x,i)=>{const d=document.createElement("details");d.dataset.extra=i>1?"1":"0";if(i>1)d.hidden=true;d.innerHTML=`<summary>${esc(x.q)}</summary><p>${esc(x.a)}</p>`;l.append(d)});if((rows||[]).length>2){const b=document.createElement("button");b.className="g7-more";b.textContent="VIEW ALL FAQs";b.onclick=()=>{const ex=$$('details[data-extra="1"]',l),show=ex.some(x=>x.hidden);ex.forEach(x=>x.hidden=!show);b.textContent=show?"SHOW LESS":"VIEW ALL FAQs"};s.append(b)}const f=$("footer")||$(".site-footer");f?f.insertAdjacentElement("beforebegin",s):document.body.append(s)}catch{}}

function wireCare(){const c=$(".care-fab");if(c){c.removeAttribute("onclick");c.onclick=careChooser}$$("a,button").forEach(x=>{if((x.textContent||"").trim().toUpperCase()==="CUSTOMER CARE"&&!x.closest(".g7-card")){x.addEventListener("click",e=>{e.preventDefault();careChooser()})}})}
function boot(){mountTop();watchAuth();wireCare();faq()}
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",boot):boot();
})();
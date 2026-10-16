(()=>{'use strict';
const $=id=>document.getElementById(id), mode=document.body.dataset.page;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(amount,currency='NGN')=>{const n=Number(amount);return Number.isFinite(n)?new Intl.NumberFormat('en-NG',{style:'currency',currency:currency||'NGN'}).format(n):'—'};
const when=s=>{if(!s)return 'Date unavailable';const d=new Date(s);return Number.isNaN(d.getTime())?'Date unavailable':d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})};
const title=(s)=>String(s||'Unknown').replace(/_/g,' ').replace(/\b\w/g,x=>x.toUpperCase());
const isPending=o=>{const s=String(o.payment_status||o.status||'').toLowerCase();return ['pending','payment_pending','unpaid'].includes(s)};
function fail(message,retry){$('content').innerHTML=`<div class="panel state"><h2>${esc(message)}</h2><p>Your GRIM account remains private. Please try again.</p><div class="actions"><button id="retry">TRY AGAIN</button><a class="chip" href="/">RETURN TO STORE</a></div></div>`;$('retry').onclick=retry}
async function load(){ $('content').innerHTML='<div class="panel state" role="status">Opening your GRIM account…</div>';
let r,data;try{r=await fetch('/api/account',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});data=await r.json();}catch{fail('Connection unavailable',load);return}
if(r.status===401||r.status===403){$('content').innerHTML='<div class="panel"><h2>Sign in to GRIM</h2><p>Sign in once on the storefront, then return to your account.</p><a class="chip" href="/?grim-signin=1">SIGN IN</a></div>';return}
if(!r.ok||!data?.user){fail('Account temporarily unavailable',load);return}
const u=data.user,w=data.wallet||{},tx=Array.isArray(data.transactions)?data.transactions:[],orders=Array.isArray(data.orders)?data.orders:[];
if(mode==='account'){
 $('content').innerHTML=`<div class="panel"><h2>ACCOUNT DETAILS</h2><div class="grid"><div class="metric"><small>NAME</small><strong>${esc(u.name||[u.firstName,u.lastName].filter(Boolean).join(' ')||'GRIM member')}</strong></div><div class="metric"><small>EMAIL</small><strong style="font-size:16px">${esc(u.email||'—')}</strong></div><div class="metric"><small>PHONE</small><strong style="font-size:17px">${esc(u.phone||'Not added')}</strong></div></div></div><div class="panel"><h2>YOUR GRIM</h2><p>${orders.length} order${orders.length===1?'':'s'} in your account history. Your wallet and order records are connected to this signed-in profile.</p><div class="actions"><a class="chip" href="/grim-my-orders.html">VIEW ORDERS</a><a class="chip" href="/grim-wallet.html">OPEN WALLET</a></div></div>`;
}else if(mode==='wallet'){
 $('content').innerHTML=`<div class="panel"><h2>GRIM WALLET</h2><div class="metric"><small>AVAILABLE BALANCE</small><strong>${esc(money(w.balance??0,w.currency||'NGN'))}</strong></div><p>Verified wallet activity associated with your account. Wallet funding and transfers remain secured by the existing payment service.</p><div class="actions"><button id="refresh">REFRESH BALANCE</button></div></div><div class="panel"><h2>TRANSACTION HISTORY</h2>${tx.length?tx.slice(0,30).map(t=>`<div class="row"><div><strong>${esc(t.description||title(t.transaction_type||t.type||'Wallet activity'))}</strong><small>${esc(when(t.created_at))} · ${esc(title(t.status||'recorded'))}</small></div><strong>${esc(money(t.amount??(Number(t.amount_minor||0)/100),t.currency||w.currency||'NGN'))}</strong></div>`).join(''):'<p>No wallet transactions yet.</p>'}</div>`; $('refresh').onclick=load;
}else{
 $('content').innerHTML=`<div class="panel"><h2>ORDER HISTORY</h2><p>All orders associated with your GRIM account, including those awaiting payment.</p>${orders.length?orders.slice(0,50).map(o=>{const status=o.payment_status==='paid'?'Paid':isPending(o)?'Awaiting payment':title(o.status||o.payment_status||'Pending');const total=Number.isFinite(Number(o.total))?money(o.total,o.currency||'NGN'):Number.isFinite(Number(o.total_kobo))?money(Number(o.total_kobo)/100,o.currency||'NGN'):'Amount unavailable';return `<div class="row"><div><strong>GRIM ORDER ${esc(String(o.payment_reference||o.id||'').slice(0,28))}</strong><small>${esc(when(o.created_at))} · ${esc(total)}</small></div><span class="tag">${esc(status)}</span></div>`}).join(''):'<div class="state"><h2>No active GRIM orders.</h2><p>Your next chapter starts here.</p><a href="/shop.html" class="chip">EXPLORE COLLECTION</a></div>'}</div>`;
}
}
load();
})();

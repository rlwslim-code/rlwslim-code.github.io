/* GRIM direct customer navigation. Existing login is retained for signed-out users. */
(()=>{'use strict';
const targets={grimMenuAccount:'/grim-account.html',grimMenuWallet:'/grim-wallet.html',grimMobileOrders:'/grim-my-orders.html'};
for(const [id,url] of Object.entries(targets)){
 const el=document.getElementById(id); if(!el)continue;
 if(el.tagName==='A')el.href=url;
 el.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();window.location.assign(url)},true);
}
const menu=document.getElementById('mobileNav'),hamb=document.querySelector('.hamb');
window.toggleMobile=function(){const open=menu?.classList.toggle('open');hamb?.setAttribute('aria-expanded',String(!!open))};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){menu?.classList.remove('open');hamb?.setAttribute('aria-expanded','false')}});
const close=()=>{menu?.classList.remove('open');hamb?.setAttribute('aria-expanded','false')};
document.addEventListener('click',e=>{if(menu?.classList.contains('open')&&!menu.contains(e.target)&&!hamb?.contains(e.target))close()});
menu?.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));
const bind=(id,fn)=>document.getElementById(id)?.addEventListener('click',()=>{close();fn()});
bind('grimMenuSettings',()=>{if(typeof window.openSettings==='function')window.openSettings();else if(typeof window.openAuth==='function')window.openAuth()});
bind('grimMenuLogout',async()=>{const btn=document.getElementById('grimMenuLogout');if(btn.disabled)return;btn.disabled=true;try{const r=await fetch('/api/logout',{method:'POST',credentials:'same-origin'});if(!r.ok)throw Error('Logout failed');location.replace('/')}catch{btn.disabled=false;alert('Unable to log out. Please try again.')}});
})();

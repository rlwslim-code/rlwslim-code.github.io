/* GRIM luxury navigation: static links, no auth-driven DOM injection. */
(()=>{'use strict';
const menu=document.getElementById('mobileNav'),hamb=document.querySelector('.hamb');
window.toggleMobile=function(){const opened=menu?.classList.toggle('open');hamb?.setAttribute('aria-expanded',String(!!opened));};
const close=()=>{menu?.classList.remove('open');hamb?.setAttribute('aria-expanded','false')};
document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
document.addEventListener('click',e=>{if(menu?.classList.contains('open')&&!menu.contains(e.target)&&!hamb?.contains(e.target))close()});
menu?.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));
const bind=(id,fn)=>document.getElementById(id)?.addEventListener('click',()=>{close();fn()});
bind('grimMenuAccount',()=>{if(typeof window.openAuth==='function')window.openAuth()});
bind('grimMenuWallet',()=>{if(typeof window.openWallet==='function')window.openWallet();else if(typeof window.openAuth==='function')window.openAuth()});
bind('grimMenuSettings',()=>{if(typeof window.openSettings==='function')window.openSettings();else if(typeof window.openAuth==='function')window.openAuth()});
bind('grimMenuLogout',async()=>{const b=document.getElementById('grimMenuLogout');if(b.disabled)return;b.disabled=true;try{const r=await fetch('/api/logout',{method:'POST',credentials:'same-origin'});if(!r.ok)throw Error('Logout failed');location.replace('/')}catch{b.disabled=false;alert('Unable to log out. Please try again.')}});
})();

/* GRIM account navigation; no checkout or payment changes. */
(()=>{'use strict';
const GOLD='#d8b66b',INK='#0c0b10';
function link(text,href){const a=document.createElement('a');a.textContent=text;a.href=href;a.style.cssText='color:'+GOLD+';border:1px solid '+GOLD+';padding:8px 12px;text-decoration:none;letter-spacing:.08em';return a;}
async function init(){try{
 const response=await fetch('/api/me',{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)return;const payload=await response.json();
 const user=payload.user||payload.customer||payload;
 if(!user || !user.email)return;
 const header=document.querySelector('.actions');
 if(header && !document.getElementById('grimAccountOrders')){
   const a=link('MY ORDERS','/account/grim-orders');a.id='grimAccountOrders';header.append(a);
   const b=document.createElement('button');b.id='grimCustomerLogout';b.type='button';b.textContent='LOG OUT';b.style.cssText='color:'+GOLD+';background:'+INK+';border:1px solid '+GOLD;
   b.addEventListener('click',async()=>{b.disabled=true;try{const r=await fetch('/api/logout',{method:'POST',credentials:'same-origin'});if(!r.ok)throw Error('logout');location.replace('/')}catch{b.disabled=false;alert('Unable to log out. Please try again.')}});header.append(b);
 }
 const mobile=document.getElementById('mobileNav');if(mobile&&!mobile.querySelector('a[href="/account/grim-orders"]'))mobile.append(link('MY ORDERS','/account/grim-orders'));
}catch{/* logged out or service unavailable */}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

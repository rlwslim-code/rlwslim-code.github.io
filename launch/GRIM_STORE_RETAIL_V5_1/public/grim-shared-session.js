/* GRIM customer session reader: same-origin, no localStorage identity. */
(()=>{'use strict';
 let inflight=null;
 const read=()=>fetch('/api/me',{credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json'}})
  .then(async r=>{if(!r.ok)throw new Error('Session service unavailable ('+r.status+')');const j=await r.json();const u=j?.user||j?.customer||j;return u?.email?Object.freeze({id:u.id,email:u.email,name:u.name||''}):null;});
 window.GRIMSession={
  current:()=>inflight||(inflight=read().finally(()=>{inflight=null})),
  refresh:()=>read(),
  signOut:async()=>{const r=await fetch('/api/logout',{method:'POST',credentials:'same-origin',cache:'no-store'});if(!r.ok)throw new Error('Unable to sign out');location.assign('/');}
 };
})();

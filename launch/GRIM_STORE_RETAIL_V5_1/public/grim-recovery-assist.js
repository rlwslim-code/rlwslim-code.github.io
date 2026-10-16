/* GRIM concise recovery display. Never changes payment data or calls payment APIs. */
(()=>{'use strict';
 const section=document.getElementById('recovery');if(!section)return;
 const status=document.getElementById('status');
 let busy=false;
 function render(){
  if(busy)return;busy=true;
  try{
   const active=!section.hidden;
   document.body.classList.toggle('grim-recovery-active',active);
   if(!active)return;
   const title=section.querySelector(':scope > h2');if(title&&title.textContent!=='PAYMENT STATUS')title.textContent='PAYMENT STATUS';
   const desc=section.querySelector(':scope > p');if(desc&&desc.textContent!=='Verify before paying again.')desc.textContent='Verify before paying again.';
   section.querySelectorAll('.grim-recovery-assist').forEach(el=>el.remove());
   const pending=section.querySelector('#pending');if(!pending)return;
   const row=pending.querySelector('.pending-item');if(!row)return;
   row.querySelectorAll('.grim-recovery-safety-note').forEach(el=>el.remove());
   const verify=[...row.querySelectorAll('button')].find(b=>/CHECK EXISTING PAYMENT|VERIFY PAYMENT/i.test(b.textContent||''));
   if(verify)verify.textContent='VERIFY PAYMENT';
   [...row.querySelectorAll('.grim-recovery-return')].slice(1).forEach(el=>el.remove());
   let help=section.querySelector('.grim-recovery-support');
   if(!help){help=document.createElement('a');help.href='/support.html';help.className='grim-recovery-support';help.textContent='CONTACT GRIM';section.appendChild(help)}
   // Shorten only the visible reference; preserve the actual value in the DOM and its click handlers.
   [...row.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).forEach(n=>{
     if(n.__grimFormatted)return;
     const s=n.textContent||'';const m=s.match(/GRIM2-[a-z0-9-]{26,}/i);
     if(m){const span=document.createElement('span');span.className='grim-ref-compact';span.textContent=`Reference ${m[0].slice(0,12)}…${m[0].slice(-6)}`;span.title=m[0];span.setAttribute('aria-label',`Payment reference ${m[0]}`);n.replaceWith(span)}
   });
  }finally{busy=false}
 }
 const ob=new MutationObserver(()=>{ob.disconnect();render();ob.observe(section,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']})});
 render();ob.observe(section,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
})();
/* GRIM admin order lifecycle controls. Requires Stage 7 admin API and approved SQL RPC. */
(()=>{'use strict';
const STATUSES=['processing','shipped','in_transit','out_for_delivery','delivered','under_review','cancelled'];
const GOLD='#d8b66b';
const panel=document.getElementById('panel-orders');if(!panel)return;
const section=document.createElement('section');section.id='grimOrderManagement';section.style.cssText='background:#0c0b10;color:#f3eee8;border:1px solid '+GOLD+';padding:18px;margin:24px 0';
const heading=document.createElement('h3');heading.textContent='GRIM · ORDER LIFECYCLE';heading.style.color=GOLD;section.append(heading);
const description=document.createElement('p');description.textContent='Verified administrative controls. Payment and refund status are never changed here.';section.append(description);
const load=document.createElement('button');load.type='button';load.textContent='LOAD ORDER CONTROLS';section.append(load);
const notice=document.createElement('p');notice.setAttribute('role','status');section.append(notice);
const table=document.createElement('div');section.append(table);panel.append(section);
async function request(url,options){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});if(!r.ok)throw Error('Service unavailable or not authorized ('+r.status+')');return r.json()}
async function refresh(){load.disabled=true;notice.textContent='Loading…';table.replaceChildren();try{
 const data=await request('/api/admin/grim-orders');const orders=Array.isArray(data.orders)?data.orders:[];
 notice.textContent=orders.length+' order(s)';for(const order of orders){
 const card=document.createElement('article');card.style.cssText='border-top:1px solid #64532f;padding:15px 0';
 const label=document.createElement('div');label.textContent='#'+order.id+' · '+(order.email||'No email')+' · '+(order.status||'new')+' · Payment: '+(order.payment_status||'unknown');card.append(label);
 const select=document.createElement('select');select.setAttribute('aria-label','New order status');for(const status of STATUSES){const opt=document.createElement('option');opt.value=status;opt.textContent=status.replaceAll('_',' ');select.append(opt)}card.append(select);
 const reason=document.createElement('input');reason.placeholder='Reason (required for review/cancellation)';reason.maxLength=500;reason.setAttribute('aria-label','Reason');card.append(reason);
 const save=document.createElement('button');save.type='button';save.textContent='UPDATE STATUS';card.append(save);
 const result=document.createElement('span');result.setAttribute('role','status');card.append(result);
 save.addEventListener('click',async()=>{if(!confirm('Update order #'+order.id+' to '+select.value+'?'))return;save.disabled=true;try{await request('/api/admin/grim-orders/'+encodeURIComponent(order.id)+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:select.value,reason:reason.value})});result.textContent=' Updated';await refresh()}catch(e){result.textContent=' '+e.message}finally{save.disabled=false}});
 table.append(card);
 }
 }catch(e){notice.textContent=e.message}finally{load.disabled=false}}
 load.addEventListener('click',refresh);
})();

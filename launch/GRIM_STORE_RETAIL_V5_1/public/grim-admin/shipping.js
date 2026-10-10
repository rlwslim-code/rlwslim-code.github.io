'use strict';
(()=>{
 const $=id=>document.getElementById(id), status=$('shippingStatus');let records=[];
 async function api(path,method='GET',body){const r=await fetch('/api/admin/checkout2/'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.message||data.error);return data;}
 // The provider setup lookup works before Checkout 2.0 is activated or migrated.
 $('findProviderCodes').onclick=async()=>{
   const state=$('providerCodeStatus');
   state.textContent='Looking up validated addresses and categories…';
   $('providerAddresses').textContent=''; $('providerCategories').textContent='';
   try{
     const setup=await api('shipping/provider-setup');
     const addresses=setup.addresses||[],categories=setup.categories||[];
     $('providerAddresses').textContent=addresses.length ? addresses.map(a=>`Code: ${a.addressCode} — ${a.city}, ${a.state} (${a.formattedAddress})`).join('\n') : 'No validated Nigerian addresses returned. Your saved sender profile may still need API address validation.';
     $('providerCategories').textContent=categories.length ? categories.map(c=>`${c.name}: ${c.categoryId}`).join('\n') : 'No shipping categories returned.';
     state.textContent=`Provider responded. Sender code configured in Vercel: ${setup.senderCodeConfigured?'yes':'no'}; category configured: ${setup.categoryConfigured?'yes':'no'}. Courier quotes: ${setup.quoteConfigured?'configured':'not configured'}.`;
   }catch(e){state.textContent=e.message||'Unable to retrieve provider setup. Sign in to the GRIM admin panel and try again.';}
 };
 const dimensions=f=>Object.fromEntries(['length','width','height'].map(k=>[k,Number(f.elements[k].value)]));
 async function load(){const data=await api('shipping');records=data.productMeasurements;const s=$('productMetrics').elements.product;s.replaceChildren();for(const p of data.products)s.add(new Option(p.name,String(p.id)));s.dispatchEvent(new Event('change'));$('measuredPackages').textContent=data.packages.map(p=>`${p.cart_key}: ${p.dimensions.length} × ${p.dimensions.width} × ${p.dimensions.height} cm`).join('\n');status.textContent=data.shippingBlocker?'Courier account configuration is incomplete. Measurements can still be saved.':'';}
 $('productMetrics').elements.product.onchange=()=>{const f=$('productMetrics'),m=records.find(x=>String(x.product_id)===f.elements.product.value);f.elements.weight.value=m?.weight_kg||'';for(const k of ['length','width','height'])f.elements[k].value=m?.dimensions?.[k]||'';};
 $('productMetrics').onsubmit=async e=>{e.preventDefault();const f=e.target;try{await api('shipping/product/'+f.elements.product.value,'PUT',{weightKg:Number(f.elements.weight.value),dimensions:dimensions(f)});await load();status.textContent='Product measurements saved.';}catch(e){status.textContent=e.message;}};
 $('packageMetrics').onsubmit=async e=>{e.preventDefault();try{await api('shipping/package','PUT',{cartKey:e.target.elements.cartKey.value,dimensions:dimensions(e.target)});await load();status.textContent='Parcel measurements saved.';}catch(e){status.textContent=e.message;}};
 $('receiptLookup').onsubmit=async e=>{e.preventDefault();try{$('receiptResult').textContent=JSON.stringify(await api('orders/'+encodeURIComponent(e.target.elements.reference.value)),null,2);}catch(e){status.textContent=e.message;}};
 load().catch(e=>status.textContent=e.message);
})();

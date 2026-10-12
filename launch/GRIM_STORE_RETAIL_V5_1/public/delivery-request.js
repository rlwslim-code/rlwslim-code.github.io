(()=>{'use strict';const $=id=>document.getElementById(id),form=$('requestForm');let loggedIn=false,submitted=false;const currency=n=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(n/100);const fail=s=>{$('result').textContent=s;};async function request(path,payload){const response=await fetch('/api/checkout2/'+path,{credentials:'same-origin',cache:'no-store',...(payload?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{})});const body=await response.json().catch(()=>({}));if(!response.ok)throw Error((body.error && body.message && body.error !== body.message) ? body.error + ': ' + body.message : (body.message||body.error||'Service unavailable'));return body;}function cartLines(){let cart=[];try{cart=JSON.parse(localStorage.getItem('grimCart')||'[]');}catch{}if(!Array.isArray(cart))return [];return cart.map(item=>({productId:String(item.id),quantity:Number(item.qty),size:String(item.size||'M')}));}async function refresh(){const button=$('refreshButton');if(button){button.disabled=true;button.textContent='REFRESHING…';} $('requests').textContent='Checking latest quotation status…';try{const r=await request('shipping/hybrid/requests');const list=r.requests||[];$('requests').replaceChildren();if(!list.length){$('requests').textContent='No requests yet.';return;}for(const q of list){const box=document.createElement('div');box.className='quote';const heading=document.createElement('h3');heading.textContent='GRIM DELIVERY QUOTATION';box.append(heading);const add=(label,value)=>{const p=document.createElement('p');const strong=document.createElement('strong');strong.textContent=label+': ';p.append(strong,document.createTextNode(value));box.append(p);};const status=String(q.status||'UNKNOWN');const subtotal=Number(q.subtotalKobo);const total=q.totalKobo==null?null:Number(q.totalKobo);const fee=q.deliveryFeeKobo!=null?Number(q.deliveryFeeKobo):(Number.isFinite(total)&&Number.isFinite(subtotal)?total-subtotal:null);add('Reference',String(q.id||'—'));add('Status',status==='QUOTE_READY'?'Delivery quote ready':status==='AWAITING_QUOTE'?'Awaiting delivery quote':status.replaceAll('_',' '));add('Products',Number.isFinite(subtotal)?currency(subtotal):'Unavailable');add('Delivery',Number.isFinite(fee)?currency(fee):'Pending confirmation');add('Total',Number.isFinite(total)?currency(total):'Awaiting quotation');add('Payment',q.paymentStatus==='paid'?'PAID — order recorded':(q.paymentStatus&&q.paymentStatus!=='not_started'?'Payment '+q.paymentStatus.replaceAll('_',' '):'Not initiated — no charge has been made on this page')); if(status==='QUOTE_READY'&&Number.isFinite(total)){const note=document.createElement('p');note.textContent=q.paymentEnabled===true?'Your delivery quotation is ready. Pay the confirmed total securely with Paystack. You will be asked to approve the payment.':'Payment unavailable: '+(q.paymentUnavailableReason||'Checkout is not enabled for this quotation.');box.append(note);
// The customer chooses before any transaction starts. Bank transfer uses Paystack;
// GRIM Wallet is a separate, server-verified deduction.
const methods = [
  ['card','PAYSTACK CARD','Secure card checkout.'],
  ['bank_transfer','BANK TRANSFER','Paystack generates transfer instructions when supported.'],
  ['wallet','GRIM WALLET','Pay from an available GRIM wallet balance.']
];
const selectedFromCheckout = new URLSearchParams(location.search).get('method');
const preselected = q.lockedMethod || (['card','bank_transfer','wallet'].includes(selectedFromCheckout) ? selectedFromCheckout : 'card');
const chooser=document.createElement('fieldset');
chooser.className='grim-quote-payment-methods';
const legend=document.createElement('legend');legend.textContent='CHOOSE PAYMENT METHOD';chooser.append(legend);
for (const [key,label,description] of methods){
  const item=document.createElement('label');item.className='grim-quote-payment-method';
  const radio=document.createElement('input');radio.type='radio';radio.name='grimQuoteMethod_'+q.id;radio.value=key;
  const enabled = !!q.availableMethods?.[key] && (!q.lockedMethod || q.lockedMethod===key);
  radio.disabled=!enabled;radio.checked=enabled && preselected===key;
  const words=document.createElement('span');words.textContent=label;
  const info=document.createElement('small');info.textContent=description;
  words.append(info);item.append(radio,words);chooser.append(item);
}
const firstEnabled=chooser.querySelector('input:not(:disabled)');
if(firstEnabled && !chooser.querySelector('input:checked'))firstEnabled.checked=true;
box.append(chooser);
if(q.lockedMethod){const locked=document.createElement('p');locked.className='notice';locked.textContent='Existing payment is locked to '+q.lockedMethod.replace('_',' ')+'. Verify or recover that payment before choosing a different method.';box.append(locked);}
const pay=document.createElement('button');pay.type='button';
const canPay = q.paymentEnabled===true && q.paymentStatus!=='paid' && !!firstEnabled;
pay.disabled=!canPay;
pay.textContent=q.paymentStatus==='paid'?'PAYMENT COMPLETED':(canPay?'CONTINUE TO SECURE PAYMENT':'PAYMENT NOT AVAILABLE');
if(canPay)pay.addEventListener('click',async()=>{
  const chosen=chooser.querySelector('input:checked:not(:disabled)');
  if(!chosen){alert('Choose an available payment method.');return;}
  pay.disabled=true;pay.textContent='CHECKING PAYMENT…';
  try{
    const result=await request('shipping/hybrid/pay',{quoteId:q.id,method:chosen.value});
    if(result.status==='paid'){fail('Payment verified and your GRIM order recorded.');await refresh();return;}
    if(result.authorizationUrl){
      const url=new URL(result.authorizationUrl);
      if(url.protocol==='https:'&&url.hostname==='checkout.paystack.com'&&!url.username&&!url.password){location.assign(url.href);return;}
      throw Error('Invalid payment destination. Payment not started.');
    }
    throw Error(result.message||'Payment recovery is required. Do not start another payment. Contact GRIM with this quotation reference.');
  }catch(e){alert(e.message);await refresh();}
});
box.append(pay);}$('requests').append(box);}}catch(e){$('requests').textContent='Refresh failed: '+e.message;}finally{if(button){button.disabled=false;button.textContent='REFRESH REQUESTS';}}}async function load(){const lines=cartLines();$('cartSummary').textContent=lines.length?`${lines.length} item line(s) from your GRIM bag. GRIM will verify product prices on the server.`:'Your GRIM bag is empty. Add products before requesting a quote.';try{const a=await request('shipping/hybrid/account');loggedIn=!!a.customer;const c=a.customer||{};let name=String(c.name||'').split(/\s+/);form.elements.firstName.value=c.firstName||name[0]||'';form.elements.lastName.value=c.lastName||name.slice(1).join(' ')||'';form.elements.phone.value=c.phone||'';const d=a.shippingAddress;if(d)for(const k of ['country','address','apartment','city','state','postal'])if(d[k]&&form.elements[k])form.elements[k].value=d[k];await refresh();}catch(e){fail('Could not confirm your GRIM customer session: '+e.message);} $('sendButton').disabled=!loggedIn||!lines.length;}$('refreshButton').addEventListener('click',e=>{e.preventDefault();refresh();});form.addEventListener('submit',async e=>{e.preventDefault();if(!loggedIn||submitted)return;const lines=cartLines();if(!lines.length){fail('Your bag is empty.');return;}const f=form.elements;const destination=Object.fromEntries(['country','address','apartment','city','state','postal'].map(k=>[k,f[k].value.trim()]));const recipient=Object.fromEntries(['firstName','lastName','phone'].map(k=>[k,f[k].value.trim()]));$('sendButton').disabled=true;fail('Submitting a request. No payment will be taken.');try{const r=await request('shipping/hybrid/request',{lines,destination,recipient});submitted=true;fail(`Delivery quote requested successfully. Reference: ${r.id}. We have not charged you. Check back here for the confirmed delivery fee.`);await refresh();}catch(e){fail(e.message);$('sendButton').disabled=false;}});load().then(async()=>{const ref=new URLSearchParams(location.search).get('reference');if(ref&&/^GRIM2-[0-9a-f-]{36}$/.test(ref)){history.replaceState(null,'',location.pathname);try{const outcome=await request('confirm',{reference:ref});fail(outcome.status==='paid'?'Payment verified and your order recorded.':(outcome.message||'Payment is still being verified. Do not pay again.'));}catch(e){fail('Verification pending: '+e.message+' Do not pay again until checked.');}await refresh();}});
/* GRIM address suggestions: same-origin Geoapify proxy, no browser API secret. */
function installQuoteAddressAutocomplete(){
  const input=form.elements.address, country=form.elements.country;
  if(!input||!country)return;
  const suggestions=document.createElement('div');
  suggestions.className='grim-quote-address-suggestions';
  suggestions.setAttribute('role','listbox');
  suggestions.hidden=true;
  input.parentElement.append(suggestions);
  input.setAttribute('autocomplete','off');
  input.setAttribute('aria-autocomplete','list');
  let controller=null,timer=null,seq=0;
  function clear(){suggestions.replaceChildren();suggestions.hidden=true;}
  function schedule(){
    clear();if(controller)controller.abort();clearTimeout(timer);
    const text=input.value.trim(), cc=country.value;
    if(text.length<3)return;
    const thisSeq=++seq;
    timer=setTimeout(async()=>{
      controller=new AbortController();
      try{
        const params=new URLSearchParams({text,country:cc});
        const res=await fetch('/api/address/autocomplete?'+params,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
        if(!res.ok)throw Error('Address suggestions unavailable');
        const body=await res.json();
        if(thisSeq!==seq||input.value.trim()!==text||country.value!==cc)return;
        const matches=(body.results||[]).filter(a=>String(a.country||'').toUpperCase()===cc).slice(0,5);
        clear();
        for(const a of matches){
          const btn=document.createElement('button');btn.type='button';btn.className='grim-quote-address-option';
          btn.setAttribute('role','option');btn.textContent=a.formatted||a.address||'';
          btn.addEventListener('click',()=>{
            input.value=a.address||a.formatted||'';
            for(const key of ['city','state','postal'])if(a[key])form.elements[key].value=a[key];
            if(a.country)country.value=a.country;
            ++seq;clear();input.dispatchEvent(new Event('change',{bubbles:true}));
          });
          suggestions.append(btn);
        }
        suggestions.hidden=!matches.length;
      }catch(e){if(e.name!=='AbortError')clear();}
    },260);
  }
  input.addEventListener('input',schedule);
  country.addEventListener('change',()=>{++seq;if(controller)controller.abort();clear();});
  document.addEventListener('click',e=>{if(!suggestions.contains(e.target)&&e.target!==input)clear();});
}
installQuoteAddressAutocomplete();
})();

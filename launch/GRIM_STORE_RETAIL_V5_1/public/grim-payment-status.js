(() => {
  const KEY='grimSavedPayment';
  const API='https://rlwslim-code-github-io.vercel.app/api/payments/verify';
  const validReference=value=>/^[A-Za-z0-9.=_-]{5,100}$/.test(String(value||''));
  const stores=[];
  for(const name of ['localStorage','sessionStorage']){try{stores.push(window[name])}catch(error){}}
  function read(){
    for(const store of stores){try{const value=JSON.parse(store.getItem(KEY)||'null');if(validReference(value?.reference))return value}catch(error){}}
    return null;
  }
  function persist(value){for(const store of stores){try{store.setItem(KEY,JSON.stringify(value));return true}catch(error){}}return false}
  const style=document.createElement('link');style.rel='stylesheet';style.href='/grim-payment-status.css?v=3';document.head.append(style);
  const root=document.createElement('div');root.className='grim-payment-status';
  root.innerHTML=`<button class="gps-launch" type="button" hidden>PAYMENT STATUS</button>
    <div class="gps-overlay" hidden><section class="gps-card" role="dialog" aria-modal="true" aria-labelledby="gps-title">
    <button class="gps-close" type="button" aria-label="Close payment status">×</button>
    <span class="gps-eyebrow">GRIM / YOUR PAYMENT</span><h2 id="gps-title">CHECKING PAYMENT</h2>
    <p class="gps-detail" role="status" aria-live="polite"></p>
    <dl><dt>REFERENCE</dt><dd class="gps-reference"></dd><dt>AMOUNT</dt><dd class="gps-amount">—</dd></dl>
    <button class="gps-check" type="button">CHECK AGAIN</button>
    <div class="gps-restore">
  <input class="gps-reference-input" type="text" placeholder="Enter Paystack reference">
  <button class="gps-use-reference" type="button">USE PAYMENT REFERENCE</button>
</div>
    <p class="gps-note">Your reference stays on this device. You can reopen PAYMENT STATUS after closing checkout.</p>
    <a href="/support.html">CONTACT GRIM CUSTOMER CARE</a>
    <button class="gps-forget" type="button">REMOVE SAVED REFERENCE</button>
    </section></div>`;
  document.body.append(root);
  const $=selector=>root.querySelector(selector);
  let busy=false;
  function status(title,detail){$('#gps-title').textContent=title;$('.gps-detail').textContent=detail}
  async function check(){
    const saved=read();if(!saved||busy)return;
    busy=true;$('.gps-check').disabled=true;
    $('.gps-reference').textContent=saved.reference;
    status('CHECKING PAYMENT','Confirming this reference with Paystack.');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:saved.reference}),signal:controller.signal});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'The payment check is temporarily unavailable.');
      if(result.reference!==saved.reference)throw new Error('The returned reference does not match.');
      if(result.verified && result.status==='success' && result.currency==='NGN' && Number.isInteger(result.amount) && result.amount>0){
        if(saved.amount && saved.amount!==result.amount)throw new Error('The payment amount does not match this checkout. Contact Customer Care.');
        $('.gps-amount').textContent=new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(result.amount/100);
        status('PAYMENT VERIFIED','Paystack confirmed this transaction. Keep the reference for order or delivery enquiries.');
      }else{status('PAYMENT NOT CONFIRMED',`Current status: ${result.status||'unknown'}. Check again before making another payment.`)}
    }catch(error){status('STATUS UNAVAILABLE',`${error.name==='AbortError'?'The check timed out.':error.message} Keep your reference and check again before paying another time.`)}
    finally{clearTimeout(timeout);busy=false;$('.gps-check').disabled=false}
  }
  function open(){if(!read())return;$('.gps-overlay').hidden=false;check()}
  function save(reference,amount){
    if(!validReference(reference))return false;
    const saved=persist({reference:String(reference),amount:Number.isInteger(amount)?amount:null});
    $('.gps-launch').hidden=!saved;
    if(saved)open();
    return saved;
  }
  $('.gps-launch').addEventListener('click',open);
  $('.gps-close').addEventListener('click',()=>{$('.gps-overlay').hidden=true});
  $('.gps-check').addEventListener('click',check);
  $('.gps-use-reference').addEventListener('click',()=>{
  const reference=$('.gps-reference-input').value.trim();

  if(!validReference(reference)){
    status(
      'INVALID REFERENCE',
      'Enter a valid Paystack payment reference.'
    );
    return;
  }

  persist({
    reference,
    amount:null
  });

  $('.gps-reference-input').value='';
  $('.gps-launch').hidden=false;

  check();
});
  $('.gps-forget').addEventListener('click',()=>{
    if(!window.confirm('Keep a copy of your payment reference before removing it from this device. Continue?'))return;
    for(const store of stores){try{store.removeItem(KEY)}catch(error){}}
    $('.gps-overlay').hidden=true;$('.gps-launch').hidden=true;
  });
  $('.gps-launch').hidden=!read();
  window.GRIMPaymentStatus={save,open};
})();

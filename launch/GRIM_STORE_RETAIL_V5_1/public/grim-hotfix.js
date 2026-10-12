// GRIM V5.1 production hardening: server-initialized checkout with timeout/retry.
(() => {
  const byId = id => document.getElementById(id);
  const value = id => byId(id)?.value?.trim() || '';
  const timeout = (promise, ms=15000) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Secure payment is taking too long. Please try again.')), ms))
  ]);

  window.startGrimPayment = async function(method) {
    const message = byId('paymentMessage');
    const button = byId(method === 'bank_transfer' ? 'payTransfer' : 'payCard');
    if (!Array.isArray(window.cart) && typeof cart === 'undefined') {
      if (message) message.textContent = 'Your bag could not be read. Refresh and try again.';
      return;
    }
    const bag = typeof cart !== 'undefined' ? cart : window.cart;
    if (!bag?.length) { if(message) message.textContent='Your bag is empty.'; return; }

    const country=value('coCountry')||'NG';
    const delivery={country,address:value('coAddress'),apartment:value('coApartment'),city:value('coCity'),state:value('coState'),postal:value('coPostal'),instructions:value('coInstructions')};
    const billingSame=byId('coBillingSame')?.checked!==false;
    const billing=billingSame ? {...delivery} : {country,address:value('coBillingAddress'),city:value('coBillingCity'),state:value('coBillingState'),postal:value('coBillingPostal')};
    const expectedAmount=Math.round(bag.reduce((sum,item)=>sum+(Number(item.price)||0)*(Number(item.qty)||0),0)*100);
    const payload={
      method,
      expectedAmount,
      saveCard:byId('coSaveCard')?.checked===true,
      customer:{email:value('coEmail'),firstName:value('coFirst'),lastName:value('coLast'),phone:value('coPhone')},
      delivery,
      billing,
      items:bag.map(item=>({id:Number(item.id),qty:Math.max(1,Number(item.qty||1)),size:String(item.size||'M')}))
    };

    if(button) button.disabled=true;
    if(message) message.textContent=method==='card'?'Preparing secure card payment…':'Preparing secure bank transfer…';
    try{
      const response=await timeout(fetch('/api/payments/initialize',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));
      let result={}; try{result=await response.json()}catch(_){}
      if(!response.ok || !result.authorizationUrl) throw new Error(result.error||'Secure checkout could not be opened.');
      sessionStorage.setItem('grimPaymentReference',result.reference||'');
      location.assign(result.authorizationUrl);
    }catch(error){
      if(message) message.textContent=(error?.message||'Payment could not start.')+' Tap the payment button to retry.';
      if(button) button.disabled=false;
    }
  };
})();

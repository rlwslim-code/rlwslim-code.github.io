(() => {
"use strict";
const byId=id=>document.getElementById(id), value=id=>String(byId(id)?.value||"").trim();
async function fetchJSON(url,options={},timeoutMs=20000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{const response=await fetch(url,{...options,signal:controller.signal,cache:"no-store"});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`Request failed (${response.status}).`);return body}
 catch(error){if(error?.name==="AbortError")throw new Error("Payment preparation timed out. No payment was opened. Please try again.");throw error}
 finally{clearTimeout(timer)}
}
function message(text){const el=byId("paymentMessage");if(el)el.textContent=text}
function getCart(){try{if(typeof cart!=="undefined"&&Array.isArray(cart))return cart}catch(_){}return Array.isArray(window.cart)?window.cart:[]}
async function canonicalAmount(items){
 const products=await fetchJSON("/api/products",{credentials:"include"});
 if(!Array.isArray(products))throw new Error("GRIM product data is unavailable.");
 const map=new Map(products.map(p=>[Number(p.id),p]));let naira=0;
 for(const item of items){const p=map.get(Number(item.id));if(!p||!Number.isFinite(Number(p.price))||Number(p.price)<=0)throw new Error("One of the items in your bag is unavailable. Refresh the shop and review your bag.");naira+=Number(p.price)*Math.max(1,Number(item.qty||1))}
 if(!Number.isFinite(naira)||naira<=0)throw new Error("Your bag total could not be calculated.");
 return Math.round(naira*100)
}
window.startGrimPayment=async function(method){
 const items=getCart(),button=byId(method==="bank_transfer"?"payTransfer":"payCard");
 if(!items.length)return message("Your bag is empty.");
 const customer={email:value("coEmail"),firstName:value("coFirst"),lastName:value("coLast"),phone:value("coPhone")};
 const delivery={country:value("coCountry")||"NG",address:value("coAddress"),apartment:value("coApartment"),city:value("coCity"),state:value("coState"),postal:value("coPostal"),instructions:value("coInstructions")};
 if(!customer.email||!customer.firstName||!customer.lastName||!customer.phone)return message("Complete your contact information first.");
 if(!delivery.address||!delivery.city||!delivery.state)return message("Complete your delivery address first.");
 if(method==="bank_transfer"&&delivery.country!=="NG")return message("Bank transfer is available for Nigerian checkout only.");
 if(button)button.disabled=true;
 message(method==="card"?"Preparing secure card payment…":"Preparing secure bank transfer…");
 try{
  const expectedAmount=await canonicalAmount(items);
  const result=await fetchJSON("/api/payments/initialize",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({method,expectedAmount,marketCountry:delivery.country,displayCurrency:(window.market?.currency||null),saveCard:byId("coSaveCard")?.checked===true,customer,delivery,billing:(byId("coBillingSame")?.checked!==false?{...delivery}:{country:delivery.country,address:value("coBillingAddress"),city:value("coBillingCity"),state:value("coBillingState"),postal:value("coBillingPostal")}),items:items.map(i=>({id:Number(i.id),qty:Math.max(1,Number(i.qty||1)),size:String(i.size||"M")}))})});
  if(byId("coSaveBilling")?.checked===true){const b=byId("coBillingSame")?.checked!==false?{country:delivery.country,address:delivery.address,city:delivery.city,state:delivery.state,postal:delivery.postal}:{country:delivery.country,address:value("coBillingAddress"),city:value("coBillingCity"),state:value("coBillingState"),postal:value("coBillingPostal")};fetch("/api/settings/shopping",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({checkoutPreferences:{savedBillingAddress:b}})}).catch(()=>{});}

  if(!result.authorizationUrl)throw new Error("Paystack did not return a secure checkout link.");
  try{sessionStorage.setItem("grim_pending_payment_reference",result.reference||"");sessionStorage.setItem("grimPaymentReference",result.reference||"")}catch(_){}
  message("Opening secure Paystack checkout…");window.location.assign(result.authorizationUrl)
 }catch(error){message((error?.message||"Payment could not start.")+" Tap the payment button to retry.");if(button)button.disabled=false}
};
})();
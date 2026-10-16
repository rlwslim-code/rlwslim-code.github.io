/* GRIM global currency context — display-only. Never used to calculate/authorize a payment. */
(()=>{'use strict';
const markets={NG:['NGN','en-NG'],US:['USD','en-US'],GB:['GBP','en-GB'],CA:['CAD','en-CA'],AU:['AUD','en-AU'],DE:['EUR','de-DE'],FR:['EUR','fr-FR'],IT:['EUR','it-IT'],ES:['EUR','es-ES'],NL:['EUR','nl-NL'],GH:['GHS','en-GH'],ZA:['ZAR','en-ZA'],KE:['KES','en-KE'],AE:['AED','en-AE'],JP:['JPY','ja-JP']};
const get=()=>{let pref={};try{pref=JSON.parse(localStorage.getItem('grimMarket')||'{}')}catch{};const country=String(pref.country||'NG').toUpperCase();const [currency,locale]=markets[country]||markets.NG;return {country,currency,locale}};
const format=(amount,currency='NGN')=>{const n=Number(amount),code=String(currency||'NGN').toUpperCase();if(!Number.isFinite(n))return '—';try{return new Intl.NumberFormat(code==='NGN'?'en-NG':undefined,{style:'currency',currency:code}).format(n)}catch{return `${n.toFixed(2)} ${code}`}};
window.GRIM_CURRENCY={get,format};
// The live Checkout 2.0 processor is NGN-denominated. Keep exact charge currency unmistakable.
function checkout(){if(!document.getElementById('checkoutForm'))return;
let label=document.getElementById('grimChargeCurrencyNotice');if(!label){label=document.createElement('p');label.id='grimChargeCurrencyNotice';label.setAttribute('role','note');label.className='grim-currency-notice';const node=document.querySelector('aside section .note')||document.querySelector('aside section');node?.insertAdjacentElement('afterend',label)}
const {currency}=get();label.textContent=currency==='NGN'?'Your payment and wallet checkout are charged in NGN.':'Your selected shopping currency is '+currency+'. Estimated storefront prices are for browsing. This checkout currently charges in NGN. Review the exact NGN total before paying; your bank may apply conversion.';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',checkout);else checkout();
})();

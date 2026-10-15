"use strict";
// Vercel geolocation is UI context, not identity or settlement authorization.
// The checkout database and Paystack integration currently settle NGN only.
const REGION = {US:['en-US','USD'],NG:['en-NG','NGN'],GB:['en-GB','GBP'],CA:['en-CA','CAD'],GH:['en-GH','GHS'],KE:['en-KE','KES'],ZA:['en-ZA','ZAR'],DE:['de-DE','EUR'],FR:['fr-FR','EUR'],ES:['es-ES','EUR'],AU:['en-AU','AUD']};
function resolveLocale(req={}) {
 const h=req.headers||{};
 const raw=String(h['x-vercel-ip-country']||h['cf-ipcountry']||'').trim().toUpperCase();
 const country=/^[A-Z]{2}$/.test(raw)?raw:'NG';
 const [locale,displayCurrency]=REGION[country]||['en-US','USD'];
 return {country,locale,displayCurrency,settlementCurrency:'NGN',displayConversionAvailable:false,
  message:country==='NG'?'Checkout charges are in Nigerian naira.':'Country detected. Checkout charges remain in Nigerian naira until international currency settlement is implemented.'};
}
module.exports={resolveLocale};

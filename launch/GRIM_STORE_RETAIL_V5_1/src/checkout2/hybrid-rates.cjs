'use strict';
// Pure pricing rules: server must authenticate admin and load rules from its database.
function money(n){if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_AMOUNT');return n}
function normalize(v){return String(v||'').normalize('NFKC').trim().toUpperCase()}
function quote({country,state,city,subtotalKobo,weightGrams=0},rules){
  money(subtotalKobo);money(weightGrams);
  const c=normalize(country),s=normalize(state),t=normalize(city);
  if(!/^[A-Z]{2}$/.test(c))throw Error('INVALID_COUNTRY');
  const matching=(rules||[]).filter(r=>r.enabled===true&&normalize(r.country)===c&&(!r.state||normalize(r.state)===s)&&(!r.city||normalize(r.city)===t)&&weightGrams<=r.maxWeightGrams);
  matching.sort((a,b)=>Number(Boolean(b.city))-Number(Boolean(a.city))||Number(Boolean(b.state))-Number(Boolean(a.state)));
  const rule=matching[0];
  if(!rule)return {kind:'MANUAL_QUOTE_REQUIRED',currency:'NGN',subtotalKobo};
  const feeKobo=money(rule.feeKobo);
  if(!Number.isSafeInteger(subtotalKobo+feeKobo))throw Error('INVALID_TOTAL');
  return {kind:'INSTANT',currency:'NGN',subtotalKobo,feeKobo,totalKobo:subtotalKobo+feeKobo,rateId:rule.id};
}
module.exports={quote};

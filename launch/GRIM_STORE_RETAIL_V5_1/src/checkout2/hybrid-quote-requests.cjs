'use strict';
const {randomUUID}=require('node:crypto');
const {buildQuote,address,CheckoutError}=require('./checkout-core.cjs');
const {contact}=require('./checkout-core.cjs');
const fail=(code,message,status=400)=>new CheckoutError(code,message,status);
const allowed=new Set(['AWAITING_QUOTE','QUOTE_READY','CANCELLED']);
function validateFee(value){if(!Number.isSafeInteger(value)||value<0||value>1000000000)throw fail('INVALID_DELIVERY_FEE','Enter a valid delivery fee in kobo.');return value;}
function validatedSnapshot({lines,destination,recipient,catalog}){
 const delivery=address(destination); const person=contact(recipient);
 const priced=buildQuote({lines,catalog,shippingKobo:0});
 return {destination:delivery,recipient:person,items:priced.items,subtotalKobo:priced.subtotalKobo,currency:'NGN'};
}
function createService({db,catalog,now=()=>new Date(),uuid=randomUUID}){
 if(!db||!catalog)throw Error('QUOTE_SERVICE_UNAVAILABLE');
 const table=()=>db.from('grim2_hybrid_quote_requests');
 async function create({customerId,lines,destination,recipient}){
  if(!customerId)throw fail('SIGN_IN_REQUIRED','Sign in to request a quote.',401);
  const snapshot=validatedSnapshot({lines,destination,recipient,catalog:await catalog(lines)});
  const expiresAt=new Date(now().getTime()+7*24*60*60*1000).toISOString();
  const record={id:uuid(),customer_id:String(customerId),status:'AWAITING_QUOTE',snapshot,subtotal_kobo:snapshot.subtotalKobo,expires_at:expiresAt};
  const {data,error}=await table().insert(record).select('id,status,subtotal_kobo,expires_at').single();
  if(error)throw fail('QUOTE_REQUEST_FAILED','Could not save the delivery request.',503);
  return {id:data.id,status:data.status,subtotalKobo:Number(data.subtotal_kobo),expiresAt:data.expires_at};
 }
 async function listCustomer(customerId){
  const {data,error}=await table().select('id,status,subtotal_kobo,fee_kobo,total_kobo,expires_at,created_at,checkout_reference').eq('customer_id',String(customerId)).order('created_at',{ascending:false}).limit(40);
  if(error)throw fail('QUOTES_UNAVAILABLE','Could not load your requests.',503);
  const references=[...new Set((data||[]).map(r=>r.checkout_reference).filter(Boolean))];
  let attempts=[];
  if(references.length){
   const result=await db.from('grim2_attempts').select('reference,status,authorization_url,order_id,method,quote').in('reference',references).eq('customer_id',String(customerId));
   if(result.error)throw fail('QUOTES_UNAVAILABLE','Could not load payment statuses.',503);
   attempts=result.data||[];
  }
  const statuses=new Map(attempts.map(a=>[a.reference,a]));
  return (data||[]).map(r=>({...view(r),paymentStatus:statuses.get(r.checkout_reference)?.status||'not_started',authorizationUrl:statuses.get(r.checkout_reference)?.authorization_url||null,orderId:statuses.get(r.checkout_reference)?.order_id||null,lockedMethod:statuses.get(r.checkout_reference)?.method==='wallet'?'wallet':(statuses.get(r.checkout_reference)?.quote?.paystackChannel==='bank_transfer'?'bank_transfer':(statuses.has(r.checkout_reference)?'card':null))}));
 }
 async function listAdmin(){
  const {data,error}=await table().select('id,status,subtotal_kobo,fee_kobo,total_kobo,expires_at,created_at,snapshot').order('created_at',{ascending:false}).limit(100);
  if(error)throw fail('QUOTES_UNAVAILABLE','Could not load quote requests.',503);
  return (data||[]).map(view);
 }
 function view(r){return {id:r.id,status:r.status,subtotalKobo:Number(r.subtotal_kobo),feeKobo:r.fee_kobo==null?null:Number(r.fee_kobo),totalKobo:r.total_kobo==null?null:Number(r.total_kobo),expiresAt:r.expires_at,createdAt:r.created_at,checkoutReference:r.checkout_reference||null, ...(r.snapshot?{snapshot:r.snapshot}:{})};}
 async function setQuote({id,feeKobo}){
  validateFee(feeKobo);
  if(!/^[0-9a-f-]{36}$/i.test(String(id)))throw fail('INVALID_QUOTE_ID','Invalid quote request.');
  const {data:existing,error:e}=await table().select('id,status,subtotal_kobo,expires_at').eq('id',id).maybeSingle();
  if(e)throw fail('QUOTE_UNAVAILABLE','Could not load quote request.',503);
  if(!existing)throw fail('QUOTE_NOT_FOUND','Quote request was not found.',404);
  if(existing.status!=='AWAITING_QUOTE')throw fail('QUOTE_NOT_EDITABLE','This quote is already finalized.',409);
  if(new Date(existing.expires_at).getTime()<=now().getTime())throw fail('QUOTE_EXPIRED','Request expired. Customer must submit again.',409);
  const subtotal=Number(existing.subtotal_kobo),total=subtotal+feeKobo;
  if(!Number.isSafeInteger(total)||total<=0)throw fail('INVALID_TOTAL','Invalid order total.');
  // Conditional update prevents a second admin action from replacing a finalized quote.
  const {data,error}=await table().update({fee_kobo:feeKobo,total_kobo:total,status:'QUOTE_READY',quoted_at:now().toISOString()}).eq('id',id).eq('status','AWAITING_QUOTE').select('id,status,subtotal_kobo,fee_kobo,total_kobo,expires_at').maybeSingle();
  if(error)throw fail('QUOTE_SAVE_FAILED','Could not save delivery quote.',503);
  if(!data)throw fail('QUOTE_NOT_EDITABLE','Quote was changed by another request.',409);
  return view(data);
 }
 return {create,listCustomer,listAdmin,setQuote};
}
module.exports={createService,validateFee,validatedSnapshot,allowed};

'use strict';
// Shipbubble validates addresses via POST. This is NOT shipment booking.
// Never log request bodies, provider payloads, or API keys.
const VALIDATE_URL = 'https://api.shipbubble.com/v1/shipping/address/validate';

class SenderValidationError extends Error {
  constructor(code, message, status=503) {
    super(message);
    this.name='SenderValidationError';
    this.code=code;
    this.status=status;
  }
}
const safeText = (value, max=220) =>
  typeof value === 'string' ? value.replace(/[\x00-\x1f]/g,' ').trim().slice(0,max) : '';
const validCode = value => Number.isSafeInteger(Number(value)) && Number(value)>0;

function validateSenderInput(source) {
  if(!source || typeof source!=='object' || Array.isArray(source))
    throw new SenderValidationError('SENDER_DETAILS_REQUIRED','Provide the sender name, email, phone and pickup address.',400);
  const {name,email,phone,address} = Object.fromEntries(['name','email','phone','address']
    .map(key => [key,typeof source[key]==='string' ? source[key].trim() : '']));
  if(name.length<2 || name.length>120 || /[\x00-\x1f]/.test(name))
    throw new SenderValidationError('INVALID_SENDER','Enter the full sender name.',400);
  if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new SenderValidationError('INVALID_SENDER','Enter a valid sender email.',400);
  if(phone.length>25 || !/^[+()0-9 .-]{7,25}$/.test(phone) || (phone.match(/\d/g)||[]).length<7)
    throw new SenderValidationError('INVALID_SENDER','Enter a valid sender phone number.',400);
  if(address.length<10 || address.length>500 || /[\x00-\x1f]/.test(address) || !/\bnigeria\b/i.test(address))
    throw new SenderValidationError('INVALID_SENDER','Enter a complete Nigerian pickup address with city, state and Nigeria.',400);
  return {name,email,phone,address};
}

function createSenderValidator({apiKey,fetchImpl=globalThis.fetch,timeoutMs=12000}) {
  if(typeof apiKey!=='string' || apiKey.length<8 || /[\s\x00-\x1f]/.test(apiKey))
    throw new SenderValidationError('SHIPBUBBLE_KEY_MISSING','Shipbubble API access is not configured on the server.');
  if(typeof fetchImpl!=='function') throw new TypeError('fetchImpl must be a function');
  return async function validateSender(source) {
    // Reject invalid input before any request that might consume Shipbubble credits.
    const body=validateSenderInput(source);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    let reply;
    try {
      const response=await fetchImpl(VALIDATE_URL,{
        method:'POST',
        headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json','Content-Type':'application/json'},
        body:JSON.stringify(body),signal:controller.signal,
      });
      if(!response.ok) {
        if(response.status===401 || response.status===403)
          throw new SenderValidationError('SHIPBUBBLE_AUTH_REJECTED','Shipbubble rejected this server API key or its permissions.',503);
        if(response.status===429)
          throw new SenderValidationError('SHIPBUBBLE_RATE_LIMITED','Shipbubble is rate-limiting validations. Wait before trying again.',429);
        if(response.status===400 || response.status===422)
          throw new SenderValidationError('SHIPBUBBLE_VALIDATION_REJECTED','Shipbubble could not validate these pickup details. Check the full address and contact information.',422);
        throw new SenderValidationError('SHIPBUBBLE_UNAVAILABLE','Shipbubble could not process the validation request.',503);
      }
      reply=await response.json();
    } catch(e) {
      if(e instanceof SenderValidationError) throw e;
      // Network timeouts can have uncertain provider outcomes: do not auto-retry.
      throw new SenderValidationError('SHIPBUBBLE_UNAVAILABLE','Shipbubble did not confirm validation. Check verified addresses before retrying.',503);
    } finally {clearTimeout(timer);}
    if(reply?.status!=='success')
      throw new SenderValidationError('SHIPBUBBLE_VALIDATION_REJECTED','Shipbubble could not validate the address. Check your details.',422);
    const result=reply?.data;
    if(!validCode(result?.address_code))
      throw new SenderValidationError('SHIPBUBBLE_RESPONSE_INVALID','Shipbubble returned no usable address code. Check verified addresses before retrying.',503);
    const countryCode=safeText(result?.country_code,4).toUpperCase();
    const country=safeText(result?.country,60).toLowerCase();
    if(countryCode!=='NG' && country!=='nigeria')
      throw new SenderValidationError('SHIPBUBBLE_RESPONSE_INVALID','Shipbubble did not confirm a Nigerian address.',503);
    return {
      addressCode:Number(result.address_code),
      formattedAddress:safeText(result.formatted_address||result.address,220),
      city:safeText(result.city,80),
      state:safeText(result.state,80),
      countryCode:'NG',
    };
  };
}

module.exports={createSenderValidator,validateSenderInput,SenderValidationError};

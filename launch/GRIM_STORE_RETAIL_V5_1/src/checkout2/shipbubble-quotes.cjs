'use strict';
// Read-only shipping integration layer. No shipment/label purchasing methods.
// https://docs.shipbubble.com/api-reference/rates/request-shipping-rates
const API = 'https://api.shipbubble.com/v1/shipping';
class ShippingError extends Error {
  constructor(code, message) { super(message); this.name = 'ShippingError'; this.code = code; }
}
const positiveInt = n => Number.isSafeInteger(Number(n)) && Number(n) > 0;
const ngnKobo = n => {
  if (typeof n !== 'number' && typeof n !== 'string') throw new ShippingError('INVALID_RATE', 'Invalid shipping price');
  const s = String(n);
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)) throw new ShippingError('INVALID_RATE', 'Invalid shipping price');
  const [whole, fraction=''] = s.split('.');
  const amount = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new ShippingError('INVALID_RATE', 'Invalid shipping price');
  return amount;
};
function createShipbubbleQuotes({ apiKey, fetchImpl = globalThis.fetch, senderAddressCode, categoryId, timeoutMs=12000 }) {
  if (typeof apiKey !== 'string' || apiKey.length < 8 || /[\s\x00-\x1f]/.test(apiKey)) throw new ShippingError('NOT_CONFIGURED','Shipping API is not configured');
  if (!positiveInt(senderAddressCode) || !positiveInt(categoryId)) throw new ShippingError('NOT_CONFIGURED','Validated sender address and fashion category required');
  async function request(path, method='GET', body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${API}${path}`, { method, headers: {
        Authorization: `Bearer ${apiKey}`, 'Content-Type':'application/json', Accept:'application/json'
      }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      if (!res.ok) throw new ShippingError('PROVIDER_UNAVAILABLE','Courier quotation service is unavailable');
      const data = await res.json();
      if (data?.status !== 'success') throw new ShippingError('PROVIDER_REJECTED','Courier quotation could not be retrieved');
      return data.data;
    } catch(e) {
      if (e instanceof ShippingError) throw e;
      throw new ShippingError('PROVIDER_UNAVAILABLE','Courier quotation service is unavailable');
    } finally { clearTimeout(timer); }
  }
  async function validateDestination({name,email,phone,address}) {
    if (![name,email,phone,address].every(x => typeof x === 'string' && x.trim().length > 2)) throw new ShippingError('INVALID_ADDRESS','A complete delivery address is required');
    const d = await request('/address/validate','POST',{name,email,phone,address});
    if (!positiveInt(d?.address_code) || (d.country_code !== 'NG' && d.country !== 'Nigeria')) throw new ShippingError('UNSUPPORTED_DESTINATION','Shipping is currently available within Nigeria only');
    return Number(d.address_code);
  }
  async function fetchRates({ destinationCode, pickupDate, items, dimension }) {
    if (!positiveInt(destinationCode)) throw new ShippingError('INVALID_ADDRESS','Validated Nigerian address required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate || '') || !Number.isFinite(Date.parse(`${pickupDate}T00:00:00Z`))) throw new ShippingError('INVALID_DATE','Valid pickup date required');
    if (!Array.isArray(items) || !items.length || items.length > 30 || items.some(x=>
      typeof x.name !== 'string' || !x.name.trim() || typeof x.description !== 'string' || !x.description.trim() || !positiveInt(x.quantity) ||
       !Number.isFinite(Number(x.unit_weight)) || Number(x.unit_weight)<=0 ||
       !Number.isFinite(Number(x.unit_amount)) || Number(x.unit_amount)<=0)) throw new ShippingError('INVALID_PACKAGE','Valid product weights, prices and quantities required');
    if (!dimension || ['length','width','height'].some(k=>!Number.isFinite(Number(dimension[k])) || Number(dimension[k])<=0)) throw new ShippingError('INVALID_PACKAGE','Valid package dimensions required');
    const d = await request('/fetch_rates','POST',{
      sender_address_code: Number(senderAddressCode), reciever_address_code: Number(destinationCode),
      pickup_date:pickupDate,category_id:Number(categoryId),package_items:items,
      package_dimension:dimension,service_type:'pickup'
    });
    if (typeof d?.request_token !== 'string' || !d.request_token || !Array.isArray(d.couriers)) throw new ShippingError('INVALID_RESPONSE','Invalid courier quotation response');
    const couriers = d.couriers.filter(x=>x && (x.rate_card_currency || x.currency) === 'NGN' && x.service_type === 'pickup')
      .map(x=>({courierId:x.courier_id,serviceCode:x.service_code,name:x.courier_name,eta:x.delivery_eta || null,
        amountKobo: ngnKobo(x.rate_card_amount ?? (x.connected_account === true ? undefined : x.total))}));
    if (!couriers.length) throw new ShippingError('NO_COURIERS','No pickup courier is available for this address');
    return { requestToken:d.request_token, couriers };
  }
  async function validateSender() {
    const d = await request(`/address/${Number(senderAddressCode)}`);
    if (d?.country_code !== 'NG' || !/ekiti/i.test(d.state || '') ||
        !/\boye(?:[-\s]ekiti)?\b/i.test([d.city,d.formatted_address,d.street].filter(Boolean).join(' ')))
      throw new ShippingError('INVALID_ORIGIN','The validated pickup address must be in Oye-Ekiti, Ekiti, Nigeria.');
    return d;
  }
  return { validateDestination, fetchRates, validateSender };
}
module.exports = { createShipbubbleQuotes, ShippingError, ngnKobo };

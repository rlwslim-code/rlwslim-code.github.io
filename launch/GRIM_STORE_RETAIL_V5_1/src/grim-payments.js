import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import { finalizePaidOrder } from './grim-paid-orders.js';
// Added payment routes. Existing pages, catalog and legacy payment receipts stay in place.
const PREFIX = /^GRIM-[a-f0-9]{32}$/;
const COUNTRIES = new Set(['NG', 'US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'GH', 'ZA', 'KE', 'AE', 'JP']);
const SIZES = new Set(['S', 'M', 'L', 'XL', 'XXL']);
const ORIGINS = new Set(['https://rlwslim-code.github.io', 'https://rlwslim-code-github-io.vercel.app', 'https://grimwear.store', 'https://www.grimwear.store']);

function field(value, label, maximum, optional = false, multiline = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  const controls = multiline ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f]/ : /[\u0000-\u001f]/;
  if ((!optional && !text) || text.length > maximum || controls.test(text)) {
    throw new Error(`Please enter a valid ${label}.`);
  }
  return text;
}

function buildOrder(body, productById, reference, mode) {
  const customer = body?.customer || {};
  const delivery = body?.delivery || {};
  const email = field(customer.email, 'email address', 254).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address.');
  }

  const contact = {
    email,
    firstName: field(customer.firstName, 'first name', 80),
    lastName: field(customer.lastName, 'last name', 80),
    phone: field(customer.phone, 'phone number', 40)
  };

  const address = {
    country: field(delivery.country, 'country', 2),
    address: field(delivery.address, 'street address', 250),
    apartment: field(delivery.apartment, 'apartment', 100, true),
    city: field(delivery.city, 'city', 100),
    state: field(delivery.state, 'state or province', 100),
    postal: field(delivery.postal, 'postal code', 30, true),
    instructions: field(delivery.instructions, 'delivery instructions', 500, true, true)
  };

  if (!COUNTRIES.has(address.country)) {
    throw new Error('Please select a supported delivery country.');
  }
  const billingInput = body?.billing || {};
  const billing = {
    country: field(billingInput.country || address.country, 'billing country', 2),
    address: field(billingInput.address || address.address, 'billing street address', 250),
    city: field(billingInput.city || address.city, 'billing city', 100),
    state: field(billingInput.state || address.state, 'billing state or province', 100),
    postal: field(billingInput.postal || address.postal, 'billing postal code', 30, true)
  };
  if (!COUNTRIES.has(billing.country)) throw new Error('Please select a supported billing country.');
  const saveCard = body?.saveCard === true;


  const channel = body?.method;

  if (!['card', 'bank_transfer'].includes(channel)) {
    throw new Error('Please choose a payment method.');
  }

  if (channel === 'bank_transfer' && address.country !== 'NG') {
    throw new Error('Bank transfer is available for Nigerian checkout only.');
  }

  if (!Array.isArray(body?.items) || !body.items.length || body.items.length > 20) {
    throw new Error('Please review the items in your bag.');
  }

  const items = [];
  const quantities = new Map();
  let amount = 0;

  for (const item of body.items) {
    if (
      !Number.isSafeInteger(item?.id) ||
      !Number.isSafeInteger(item?.qty) ||
      item.qty < 1 ||
      item.qty > 10 ||
      !SIZES.has(item?.size)
    ) {
      throw new Error('Each item needs a valid size and a quantity between 1 and 10.');
    }

    const product = productById(item.id);

    if (!product?.active || !Number.isSafeInteger(product.price) || product.price <= 0) {
      throw new Error('An item in your bag is unavailable. Please review your bag.');
    }

    const key = `${item.id}:${item.size}`;
    const quantity = (quantities.get(key) || 0) + item.qty;

    if (quantity > 10) {
      throw new Error('Please limit each product and size to 10 pieces.');
    }

    quantities.set(key, quantity);

    const line = items.find(
      value => value.id === item.id && value.size === item.size
    );

    if (line) {
      line.qty += item.qty;
    } else {
      items.push({
        id: product.id,
        name: product.name,
        type: product.type,
        color: product.color,
        size: item.size,
        qty: item.qty,
        price: product.price
      });
    }

    amount += product.price * item.qty * 100;
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Please review your bag total.');
  }

  return {
    version: 1,
    reference,
    mode,
    currency: 'NGN',
    amount,
    customer: contact,
    delivery: address,
    billing,
    saveCard,
    items,
    deliveryFeeIncluded: false
  };
}

function sign(orderJSON, secret) {
  return createHmac('sha256', secret)
    .update('GRIM-order-v1\n')
    .update(orderJSON)
    .digest('hex');
}

function signedOrder(metadata, secret) {
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return null;
    }
  }

  const json = metadata?.grim_order;
  const signature = metadata?.grim_signature;

  if (
    typeof json !== 'string' ||
    json.length > 30000 ||
    !/^[a-f0-9]{64}$/.test(signature || '')
  ) {
    return null;
  }

  if (
    !timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(sign(json, secret), 'hex')
    )
  ) {
    return null;
  }

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function checkoutURL(value) {
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://checkout.paystack.com' &&
      !url.username &&
      !url.password
    )
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function installGrimPayments(
  app,
  {
    productById,
    supabase = null,
    fetchImpl = globalThis.fetch,
    secretKey = () => process.env.PAYSTACK_SECRET_KEY
  }
) {
  function configuration() {
    const secret = String(secretKey() || '').trim();

    if (!/^sk_(live|test)_[a-zA-Z0-9]+$/.test(secret)) {
      throw new Error(
        'Secure payment is not configured. Please contact GRIM Customer Care.'
      );
    }

    return {
      secret,
      mode: secret.startsWith('sk_live_') ? 'live' : 'test'
    };
  }

  const cleanEmail = v => String(v || '').trim().toLowerCase();

  async function signedInCustomer(req) {
    const email=cleanEmail(req.session?.user?.email);
    if(!supabase || !email) return null;
    const {data,error}=await supabase.from('customers').select('*').eq('email',email).maybeSingle();
    if(error) throw error;
    return data || null;
  }

  function savedMethods(customer) {
    const prefs=customer?.checkout_preferences;
    const list=Array.isArray(prefs?.savedPaymentMethods) ? prefs.savedPaymentMethods : [];
    return list.filter(x=>x && typeof x==='object');
  }

  async function writeMethods(customer, methods) {
    const prefs=(customer?.checkout_preferences && typeof customer.checkout_preferences==='object')
      ? customer.checkout_preferences : {};
    const next={...prefs,savedPaymentMethods:methods.slice(0,5)};
    const {error}=await supabase.from('customers').update({checkout_preferences:next}).eq('id',customer.id);
    if(error) throw error;
    customer.checkout_preferences=next;
  }

  async function storeReusableAuthorization(req, order, authorization) {
    if(!supabase || order?.saveCard!==true || authorization?.reusable!==true ||
       typeof authorization?.authorization_code!=='string') return null;
    const customer=await signedInCustomer(req);
    if(!customer || cleanEmail(customer.email)!==cleanEmail(order.customer?.email)) return null;

    const signature=String(authorization.signature || '');
    const existing=savedMethods(customer);
    const id=signature || createHmac('sha256', configuration().secret)
      .update(authorization.authorization_code).digest('hex').slice(0,32);
    const method={
      id,
      authorizationCode:authorization.authorization_code,
      brand:String(authorization.brand || authorization.card_type || 'Card'),
      last4:String(authorization.last4 || ''),
      expMonth:String(authorization.exp_month || ''),
      expYear:String(authorization.exp_year || ''),
      bank:String(authorization.bank || ''),
      countryCode:String(authorization.country_code || ''),
      signature,
      reusable:true,
      savedAt:new Date().toISOString()
    };
    await writeMethods(customer,[method,...existing.filter(x=>x.id!==id)]);
    return {id:method.id,brand:method.brand,last4:method.last4,expMonth:method.expMonth,
      expYear:method.expYear,bank:method.bank,countryCode:method.countryCode};
  }

  function publicMethod(m) {
    return {id:m.id,brand:m.brand,last4:m.last4,expMonth:m.expMonth,expYear:m.expYear,
      bank:m.bank,countryCode:m.countryCode};
  }

  async function paystack(path, config, body) {
    const response = await fetchImpl(
      `https://api.paystack.co/transaction/${path}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${config.secret}`,
          'Content-Type': 'application/json'
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000)
      }
    );

    const result = await response.json();

    if (!response.ok || result.status !== true || !result.data) {
      const error = new Error(
        'Paystack could not complete this request. Keep your reference and contact Customer Care if money has left your account.'
      );

      error.statusCode =
        response.status === 400 || response.status === 404
          ? 400
          : 502;

      throw error;
    }

    return result.data;
  }

  app.get('/api/payments/methods', async (req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{
      const customer=await signedInCustomer(req);
      if(!customer) return res.status(401).json({error:'Sign in to view saved payment methods.'});
      return res.json({ok:true,methods:savedMethods(customer).map(publicMethod)});
    }catch(e){
      console.error('[GRIM saved payment methods]',e);
      return res.status(500).json({error:'Unable to load saved payment methods.'});
    }
  });

  app.delete('/api/payments/methods/:id', async (req,res)=>{
    try{
      const customer=await signedInCustomer(req);
      if(!customer) return res.status(401).json({error:'Sign in to continue.'});
      const id=String(req.params.id||'').slice(0,200);
      const methods=savedMethods(customer);
      await writeMethods(customer,methods.filter(x=>x.id!==id));
      return res.json({ok:true});
    }catch(e){
      console.error('[GRIM delete payment method]',e);
      return res.status(500).json({error:'Unable to remove saved payment method.'});
    }
  });

  app.post('/api/payments/initialize', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    let config;

    try {
      config = configuration();
    } catch (error) {
      return res.status(503).json({
        ok: false,
        error: error.message
      });
    }

    const reference =
      `GRIM-${randomBytes(16).toString('hex')}`;

    let order;

    try {
      order = buildOrder(
        req.body,
        productById,
        reference,
        config.mode
      );
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: error.message
      });
    }

    if (req.body.expectedAmount !== order.amount) {
      return res.status(409).json({
        ok: false,
        error:
          'Your bag price has changed. Refresh the shop and review your bag before paying.'
      });
    }

    const previewOrigin =
      process.env.VERCEL_ENV === 'preview' &&
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : null;

    const origin =
      ORIGINS.has(req.headers.origin) ||
      req.headers.origin === previewOrigin
        ? req.headers.origin
        : 'https://rlwslim-code.github.io';

    const orderJSON = JSON.stringify(order);

    const address = [
      order.delivery.address,
      order.delivery.apartment,
      order.delivery.city,
      order.delivery.state,
      order.delivery.postal,
      order.delivery.country
    ]
      .filter(Boolean)
      .join(', ');

    const custom = (
      display_name,
      variable_name,
      value
    ) => ({
      display_name,
      variable_name,
      value
    });

    try {
      const transaction = await paystack(
        'initialize',
        config,
        {
          email: order.customer.email,
          amount: order.amount,
          currency: order.currency,
          reference,
          channels: [req.body.method],
          callback_url: `${origin}/?grim-payment=return`,
          metadata: JSON.stringify({
            grim_order: orderJSON,
            grim_signature: sign(
              orderJSON,
              config.secret
            ),
            cancel_action:
              `${origin}/?grim-payment=cancel`,
            custom_fields: [
              custom(
                'GRIM Customer',
                'grim_customer',
                `${order.customer.firstName} ${order.customer.lastName}`
              ),
              custom(
                'Phone',
                'grim_phone',
                order.customer.phone
              ),
              custom(
                'Delivery Address',
                'grim_address',
                address
              ),
              custom(
                'GRIM Items',
                'grim_items',
                order.items
                  .map(
                    item =>
                      `${item.name} / ${item.type} / ${item.color} / ${item.size} / Qty ${item.qty}`
                  )
                  .join('; ')
              ),
              custom(
                'Delivery Instructions',
                'grim_instructions',
                order.delivery.instructions ||
                  'None'
              ),
              custom(
                'Delivery Fee',
                'grim_delivery_fee',
                'Not included in this product payment; quoted separately.'
              )
            ]
          })
        }
      );

      const authorizationURL =
        checkoutURL(
          transaction.authorization_url
        );

      if (
        transaction.reference !== reference ||
        !authorizationURL
      ) {
        throw new Error(
          'Paystack returned an invalid checkout response. Please contact Customer Care.'
        );
      }

      return res.json({
        ok: true,
        reference,
        amount: order.amount,
        currency: order.currency,
        mode: config.mode,
        authorizationUrl: authorizationURL
      });
    } catch (error) {
      return res
        .status(error.statusCode || 502)
        .json({
          ok: false,
          reference,
          error:
            error.name === 'TimeoutError'
              ? 'Payment preparation timed out. No checkout was opened. Please try again.'
              : error.message
        });
    }
  });

  /*
   * Mount before any legacy verify route. Old references can fall through,
   * while GRIM references are handled here.
   */
  app.post(
    '/api/payments/verify',
    async (req, res, next) => {
      const reference =
        String(
          req.body?.reference || ''
        ).trim();

      if (!reference.startsWith('GRIM-')) {
        return next();
      }

      res.setHeader(
        'Cache-Control',
        'no-store'
      );

      if (!PREFIX.test(reference)) {
        return res.status(400).json({
          ok: false,
          verified: false,
          error:
            'Invalid GRIM payment reference.'
        });
      }

      try {
        const config = configuration();

        const data = await paystack(
          `verify/${encodeURIComponent(reference)}`,
          config
        );

        const order = signedOrder(
          data.metadata,
          config.secret
        );

        const checks = {
          signedOrder: !!order,

          version:
            order?.version === 1,

          reference:
            !!order &&
            order.reference === reference &&
            data.reference === reference,

          amount:
            !!order &&
            Number.isSafeInteger(
              order.amount
            ) &&
            order.amount > 0 &&
            data.amount === order.amount,

          currency:
            !!order &&
            order.currency === 'NGN' &&
            data.currency === order.currency,

          mode:
            !!order &&
            order.mode === config.mode &&
            data.domain === config.mode,

          email:
            !!order &&
            typeof order.customer?.email ===
              'string' &&
            String(
              data.customer?.email || ''
            ).toLowerCase() ===
              order.customer.email.toLowerCase()
        };

        const matches =
          Object.values(
            checks
          ).every(Boolean);

        const paid =
          data.status === 'success';

        if (!matches) {
          console.error(
            'GRIM payment integrity mismatch:',
            reference,
            checks
          );

          return res.json({
            ok: true,
            verified: false,
            paystackPaid: paid,
            orderVerified: false,
            reference,
            amount: data.amount,
            currency: data.currency,
            status: data.status,
            checks
          });
        }

        let storedOrder = null;

if (paid) {
  try {
    storedOrder =
      await finalizePaidOrder({
        order,
        reference
      });
  } catch (error) {
    console.error(
      "[GRIM] paid order persistence:",
      error?.message || error
    );

    return res.status(503).json({
      ok: false,
      verified: true,
      paystackPaid: true,
      orderVerified: true,
      orderStored: false,
      reference,
      amount: data.amount,
      currency: data.currency,
      status: data.status,
      error:
        "Payment was received, but the order could not be synced automatically. Do not pay again. Keep this reference and contact GRIM Customer Care."
    });
  }
}

let savedPaymentMethod = null;
if (paid) {
  try {
    savedPaymentMethod = await storeReusableAuthorization(req, order, data.authorization);
  } catch (error) {
    console.error('[GRIM saved card persistence]', error);
    // The order is already paid: never turn a successful payment into a failed order
    // just because optional card-saving failed.
  }
}

return res.json({
  ok: true,
  verified: paid,
  paystackPaid: paid,
  orderVerified: paid,
  orderStored: paid ? true : false,
  orderId: storedOrder?.id ?? null,
  reusableAuthorization: savedPaymentMethod,
  reference,
  amount: data.amount,
  currency: data.currency,
  status: data.status
});
      } catch (error) {
        return res
          .status(error.statusCode || 503)
          .json({
            ok: false,
            verified: false,
            reference,
            error:
              error.name === 'TimeoutError'
                ? 'The payment check timed out. Keep your reference and check again before paying another time.'
                : error.message
          });
      }
    }
  );
}

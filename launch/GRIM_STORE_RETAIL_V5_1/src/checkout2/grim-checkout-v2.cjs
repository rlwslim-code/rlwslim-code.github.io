"use strict";
const crypto = require("node:crypto");
const {
  buildQuote,
  verifyProvider,
  authorizationOK,
  address,
  contact,
  CheckoutError,
} = require("./checkout-core.cjs");
const refOK = (x) =>
  typeof x === "string" &&
  /^GRIM2-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    x,
  );
const keyOK = (x) => typeof x === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(x);
function createEngine({
  catalog,
  store,
  provider,
  callbackBase,
  shippingKobo = 0,
  mode = "test",
  walletEnabled = true,
  quotePaystackDualChannelEnabled = false,
  bankTransferEnabled = false,
  shippingResolver = null,
  shippingRequired = false,
  acceptNewOrders = true,
}) {
  const view = (row) => ({
    reference: row.reference,
    status: row.status,
    method: row.method,
    quote: row.quote,
    authorizationUrl: row.authorization_url || null,
    orderId: row.order_id || null,
    receipt: row.payment_evidence || null,
  });
  async function quote(lines) {
    return buildQuote({ lines, catalog: await catalog(lines), shippingKobo });
  }
  async function owned(reference, customerId) {
    if (!refOK(reference))
      throw new CheckoutError(
        "INVALID_REFERENCE",
        "Invalid payment reference.",
      );
    const row = await store.get(reference);
    if (!row || (customerId !== null && row.customer_id !== String(customerId)))
      throw new CheckoutError("NOT_FOUND", "Checkout not found.", 404);
    return row;
  }
  async function start(input) {
    const { customerId, email, lines, key, method = "card" } = input;
    if (
      !customerId ||
      typeof email !== "string" ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      email.length > 254
    )
      throw new CheckoutError("INVALID_CUSTOMER", "Sign in to continue.", 401);
    if (!keyOK(key) || !["card", "bank_transfer", "wallet"].includes(method))
      throw new CheckoutError("INVALID_REQUEST", "Invalid checkout request.");
    if (method === 'bank_transfer' && !bankTransferEnabled) throw new CheckoutError('TRANSFER_DISABLED','Bank transfer is unavailable.',503);
    if (method === 'wallet' && !walletEnabled) throw new CheckoutError('WALLET_DISABLED','Wallet checkout is unavailable.',503);
    // Resolve retries before repricing: a price change must not conceal an existing payment.
    const existing = await store.byKey(String(customerId), key);
    if(!acceptNewOrders) {
      if(existing?.status === "paid") return view(existing);
      throw new CheckoutError("ORDERING_PAUSED","New payments are paused. You can still check and recover an existing card payment.",503);
    }
    let row = existing;
    if (!row) {
      const shipping = address(input.shipping),
        billing = address(input.billing || input.shipping),
        person = contact(input.contact);
      if (shippingRequired && shipping.country !== "NG") throw new CheckoutError("UNSUPPORTED_DESTINATION","Shipping is currently within Nigeria only.",409);
      if (shippingRequired && (!shippingResolver || !input.shippingSelectionToken))
        throw new CheckoutError('SHIPPING_REQUIRED','Select a quoted delivery courier before paying.',409);
      const delivery = shippingRequired ? await shippingResolver({
        customer:{id:String(customerId),email,name:`${person.firstName} ${person.lastName}`,phone:person.phone},
        lines,destination:shipping,selectionToken:input.shippingSelectionToken
      }) : null;
      if (shippingRequired && (!Number.isSafeInteger(delivery?.shippingKobo) || delivery.shippingKobo < 0))
        throw new CheckoutError('SHIPPING_INVALID','Delivery quotation is unavailable.',409);
      const priced = delivery?.quote || buildQuote({lines,catalog:await catalog(lines),shippingKobo:delivery?.shippingKobo ?? shippingKobo});
      if (delivery?.courier) priced.courier = delivery.courier;
      if (method === 'bank_transfer') priced.paystackChannel = 'bank_transfer';
      if(input.expectedTotalKobo !== priced.totalKobo)throw new CheckoutError('PRICE_CHANGED','Your bag total changed. Review the updated total before paying.',409);
      row = await store.create({
        reference: `GRIM2-${crypto.randomUUID()}`,
        customerId: String(customerId),
        email: email.toLowerCase(),
        key,
        method: method === 'wallet' ? 'wallet' : 'card',
        quote: priced,
        shipping,
        billing,
        contact: person,
      });
    }
    const storedChoice = row.method === 'wallet' ? 'wallet' : row.quote?.paystackChannel === 'bank_transfer' ? 'bank_transfer' : 'card';
    if (storedChoice !== method) throw new CheckoutError('METHOD_LOCKED','Recover your existing payment before changing methods.',409);
    if (row.status === "cancelled") throw new CheckoutError("CHECKOUT_CANCELLED","Request a fresh checkout before paying.",409);
    if (row.status === "paid") return view(row);
    if (row.method === "wallet") {
      if (!walletEnabled) throw new CheckoutError("WALLET_DISABLED", "Wallet payments are temporarily unavailable.", 503);
      const addressKey=x=>JSON.stringify(["country","address","apartment","city","state","postal"].map(k=>address(x)[k]));
      const contactKey=x=>JSON.stringify(["firstName","lastName","phone"].map(k=>contact(x)[k]));
      const bagKey=items=>items.map(i=>`${i.productId}:${i.size || 'M'}:${i.quantity}`).sort().join('|');
      if(row.status!=='paid' && (bagKey(lines || [])!==bagKey(row.quote.items || []) || input.expectedTotalKobo!==row.quote.totalKobo || addressKey(input.shipping)!==addressKey(row.shipping) || contactKey(input.contact)!==contactKey(row.contact)))
        throw new CheckoutError('WALLET_CHECKOUT_CHANGED','Recover or close your original wallet checkout before paying for a changed bag.',409);
      if (row.quote.shippingExpiresAt && Date.now() >= row.quote.shippingExpiresAt && row.status !== "paid") throw new CheckoutError("SHIPPING_QUOTE_EXPIRED_OR_CHANGED","This wallet quote expired. Contact GRIM to close the unpaid attempt before requesting another quote.",409);
      return wallet(row);
    }
    return initiateCard(row);
  }
  async function initiateCard(row, callbackPath = "/checkout2.html") {
    if (row.method !== 'card') throw new CheckoutError('METHOD_MISMATCH','This checkout cannot be paid through Paystack.',409);
    if (row.status === "paid") return view(row);
    // Do not resume a Paystack authorization when the approved delivery quote expired;
    // any already-settled transaction must still be reconciled independently.
    if (row.quote?.shippingExpiresAt && Date.now() >= Number(row.quote.shippingExpiresAt))
      throw new CheckoutError('QUOTE_EXPIRED','The approved delivery quotation has expired. Contact GRIM before paying.',409);
    if (row.authorization_url) return view(row);
    if (["initializing", "initialization_unknown", "reconciliation_required"].includes(row.status)) return { ...view(row), message:"Existing payment attempt needs verification. Do not pay twice." };
    if (!(await store.claim(row.reference)))
      return view(await store.get(row.reference));
    try {
      const payment = await provider.initialize({
        reference: row.reference,
        email: row.email,
        amount: row.quote.totalKobo,
        currency: "NGN",
        callback_url: `${callbackBase}${callbackPath}?reference=${encodeURIComponent(row.reference)}`,
        // DB-stored method preference, not a browser-controlled amount/channel.
        channels: row.quote?.paystackChannel === 'bank_transfer' ? ['bank_transfer'] :
          // For legacy card-only SQL attempts on approved manual quotes, Paystack
          // can safely offer the customer BOTH card and transfer on the SAME
          // reference. Neither channel requires a new Supabase RPC or manual link.
          // The chosen channel is verified by Paystack when reconciling the charge.
          (quotePaystackDualChannelEnabled && row.quote?.manualQuoteId && !row.quote?.paystackChannel)
            ? ['card', 'bank_transfer'] : ['card'],
        metadata: {
          grim_checkout2: true,
          cancel_action: `${callbackBase}${callbackPath}?reference=${encodeURIComponent(row.reference)}`,
        },
      });
      if (!authorizationOK(payment?.authorization_url))
        throw Error("Invalid authorization URL");
      await store.initialized(row.reference, payment.authorization_url);
      return view({
        ...row,
        status: "pending",
        authorization_url: payment.authorization_url,
      });
    } catch {
      await store.flag(row.reference, "initialization_unknown").catch(() => {});
      return {
        ...view(row),
        status: "initialization_unknown",
        message:
          "Payment could not be opened. Check this reference before starting another payment.",
      };
    }
  }
  async function wallet(row) {
    if (row.status === "paid") return view(row);
    try {
      return view(await store.completeWallet(row.reference));
    } catch (e) {
      if (/insufficient|frozen|inactive/i.test(e.message))
        throw new CheckoutError(
          "WALLET_UNAVAILABLE",
          "Your GRIM Wallet has insufficient funds or is unavailable.",
          409,
        );
      throw e;
    }
  }
  async function reconcile(reference, customerId = null) {
    const row = await owned(reference, customerId);
    if (row.status === "paid" || row.method === "wallet") return view(row);
    const payment = await provider.verify(reference);
    const verified = verifyProvider({
      expected: { reference, email: row.email, totalKobo: row.quote.totalKobo },
      provider: payment, mode,
    });
    // Require the channel recorded when this confirmed quote was first claimed.
    // Older card checkouts had no stored channel and retain their existing rules.
    if (payment.status === 'success' && row.quote?.paystackChannel &&
        payment.channel !== row.quote.paystackChannel)
      throw new CheckoutError('PAYMENT_CHANNEL_MISMATCH',
        'Paystack payment channel differs from the selected method. Manual reconciliation required.',409);
    if (payment.status !== "success")
      return {
        ...view(row),
        status: payment.status === "failed" ? "failed" : "pending",
        providerStatus: String(payment.status || "unknown"),
      };
    try {
      return view(
        await store.complete({ reference, providerId: String(payment.id), evidence: verified.evidence }),
      );
    } catch (error) {
      // This is a verified Paystack charge whose DB finalize failed. Keep the
      // charge reference in an unresolved state; never initialize another one.
      // Vercel server logs expose the SQLSTATE needed to fix the real schema/RPC
      // problem, while the customer gets no raw database details.
      const safe = value => String(value || '')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
        .replace(/sk_(?:live|test)_[A-Za-z0-9]+/g, '[secret]')
        .slice(0, 320);
      console.error('[GRIM2 ORDER RECONCILIATION FAILURE]', {
        reference,
        operation: safe(error?.operation || 'grim2_finish_card_live_verified'),
        dbCode: safe(error?.code || 'unknown'),
        dbMessage: safe(error?.databaseMessage || error?.message || 'unavailable'),
        dbHint: safe(error?.databaseHint),
        dbDetails: safe(error?.databaseDetails),
      });
      try {
        await store.flag(reference, "reconciliation_required");
      } catch (flagError) {
        console.error('[GRIM2 RECONCILIATION STATUS UPDATE FAILED]', {
          reference, code: safe(flagError?.code || 'unknown'),
          message: safe(flagError?.databaseMessage || flagError?.message),
        });
      }
      return {
        ...view(row),
        status: "reconciliation_required",
        message: "Payment confirmed by the provider. Order recording is pending; do not pay again. Contact GRIM with this reference.",
      };
    }
  }
  async function startManualQuote({quoteId,customerId,email,method='card',bankTransferEnabled=false,walletCheckoutEnabled=false}) {
    if (!acceptNewOrders) throw new CheckoutError('ORDERING_PAUSED','Payments are paused.',503);
    if (mode !== 'live' || !store.startManualQuote) throw new CheckoutError('FEATURE_DISABLED','Confirmed quote payment unavailable.',503);
    if (!['card','bank_transfer','wallet'].includes(method)) throw new CheckoutError('INVALID_METHOD','Choose a valid payment method.',400);
    if (method === 'wallet' && (!walletEnabled || !walletCheckoutEnabled)) throw new CheckoutError('WALLET_DISABLED','GRIM Wallet checkout has not been enabled.',503);
    if (method === 'bank_transfer' && !bankTransferEnabled) throw new CheckoutError('TRANSFER_DISABLED','Paystack bank transfer checkout has not been enabled.',503);
    const row = await store.startManualQuote({quoteId,customerId,email,method,reference:`GRIM2-${crypto.randomUUID()}`});
    if (!row || row.customer_id !== String(customerId)) throw new CheckoutError('PAYMENT_MISMATCH','Payment ownership could not be confirmed.',503);
    const storedMethod = row.method === 'wallet' ? 'wallet' :
      row.method === 'card' ? (row.quote?.paystackChannel === 'bank_transfer' ? 'bank_transfer' : 'card') : null;
    if (storedMethod !== method) throw new CheckoutError('METHOD_LOCKED',
      `This quotation already has a ${storedMethod || 'different'} payment attempt. Verify or recover it before changing payment methods.`,409);
    if (row.status === 'paid') return view(row);
    if (row.status === 'cancelled') throw new CheckoutError('CHECKOUT_CANCELLED','This payment reference was cancelled. Contact GRIM to request a new quotation.',409);
    if (method === 'wallet') {
      // Completing a wallet payment is an irreversible debit: the DB function
      // checks expiry, locks the attempt and wallet, and commits a single receipt.
      if (row.quote?.shippingExpiresAt && Date.now() >= Number(row.quote.shippingExpiresAt))
        throw new CheckoutError('QUOTE_EXPIRED','The approved delivery quotation has expired.',409);
      return wallet(row);
    }
    return initiateCard(row,'/delivery-request.html');
  }
  return {
    startManualQuote,
    start,
    closeWallet: async ({reference,customerId}) => { await owned(reference,customerId); return view(await store.cancelWallet(reference)); },
    quote,
    confirm: ({ reference, customerId }) => reconcile(reference, customerId),
    reconcile,
    view,
  };
}
module.exports = { createEngine, refOK, keyOK };

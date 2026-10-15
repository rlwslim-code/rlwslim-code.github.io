const { allowedOrigin } = require('./allowed-origin.cjs');
"use strict";
const express = require("express");
const { createEngine, refOK } = require("./grim-checkout-v2.cjs");
const {
  paystackSignatureIsValid,
  address,
  CheckoutError,
} = require("./checkout-core.cjs");
const { createPaystack, createSupabaseStore } = require("./adapters.cjs");
const { createShippingQuoteFlow } = require("./shipping-quote-flow.cjs");
const { resolveLocale } = require("./country-context.cjs");
function createRoutes({
  catalog,
  sessionUser,
  config,
  store,
  provider,
  customerProfile,
  shippingQuoteFlow,
  quoteRequests,
}) {
  const router = express.Router();
  store =
    store ||
    (config.ready
      ? createSupabaseStore({ url: config.url, serviceKey: config.serviceKey, mode: config.mode || "test" })
      : null);
  const engine = config.ready
    ? createEngine({
        catalog,
        store,
        provider: provider || createPaystack(config.secret, fetch, config.mode || "test"),
        callbackBase: config.base,
        mode: config.mode || "test",
        walletEnabled: config.walletEnabled !== false,
        bankTransferEnabled: config.bankTransferEnabled === true,
        quotePaystackDualChannelEnabled: config.quotePaystackDualChannelEnabled === true,
        acceptNewOrders: config.acceptNewOrders !== false,
        shippingKobo: config.shippingKobo || 0,
        shippingRequired: config.shippingRequired === true || config.mode === 'live',
        shippingResolver: shippingQuoteFlow ? shippingQuoteFlow.resolve : null,
      })
    : null;
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/config", async (req, res) => {
    let dbReady = false;
    if (config.ready)
      try {
        dbReady = (await store.health()) === true;
      } catch {}
    res.json({
      enabled: !!config.enabled,
      ready: config.ready && dbReady,
      mode: config.mode || "test",
      walletEnabled: config.walletEnabled !== false,
      bankTransferEnabled: config.bankTransferEnabled === true,
      currency: "NGN",
      countryContext: resolveLocale(req),
      internationalCheckoutAvailable: false, // prices, ledger and Paystack integration currently NGN-only
      acceptingOrders: config.acceptNewOrders !== false,
      shippingRequired: config.shippingRequired === true || config.mode === 'live',
      shippingAvailable: !!shippingQuoteFlow,
      blockers: [
        ...config.blockers,
        ...(config.ready && !dbReady
          ? ["Checkout database migration is unavailable."]
          : []),
      ],
    });
  });
  router.use(async (req, res, next) => {
    const standaloneQuoteRoute = req.path === '/shipping/hybrid/account' || req.path === '/shipping/hybrid/requests' || req.path === '/shipping/hybrid/request' || req.path === '/shipping/hybrid/pay';
    if (!engine && !standaloneQuoteRoute && req.path !== '/webhook')
      return res
        .status(503)
        .json({
          error: "CHECKOUT_UNAVAILABLE",
          message: "Checkout configuration is incomplete.",
        });
    if (req.path === "/webhook") return next();
    let u;
    try { u = await sessionUser(req); } catch (e) {
      // Quote-only requests may use the existing storefront session even if the
      // separate Checkout 2.0 customer adapter cannot access its database.
      if (!standaloneQuoteRoute) return res.status(503).json({error:"ACCOUNT_UNAVAILABLE",message:"Your account could not be confirmed."});
    }
    if (standaloneQuoteRoute && (!u?.id || !u?.email)) {
      const sessionCustomer = req.session?.user;
      // Trust only the server-managed, signed Express session (never browser
      // identifiers or request bodies). Keep normal Checkout 2.0 isolated.
      if (sessionCustomer?.id != null && typeof sessionCustomer.email === 'string'
          && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sessionCustomer.email)) {
        u = {
          id: sessionCustomer.id, email: sessionCustomer.email,
          name: sessionCustomer.name || '',
          firstName: sessionCustomer.firstName || '',
          lastName: sessionCustomer.lastName || '',
          phone: sessionCustomer.phone || ''
        };
      }
    }
    if (!u?.id || !u?.email)
      return res
        .status(401)
        .json({
          error: "SIGN_IN_REQUIRED",
          message: "Sign in to your GRIM account to continue.",
        });
    req.checkoutCustomer = {
      id: String(u.id),
      email: u.email,
      name: u.name || "",
      firstName: u.firstName || "",
      lastName: u.lastName || "",
      phone: u.phone || "",
    };
    if (req.method !== "GET" && !allowedOrigin(req.headers.origin, config))
      return res
        .status(403)
        .json({
          error: "ORIGIN_REJECTED",
          message: "Open checkout on this GRIM website.",
        });
    next();
  });
  const fail = (res, e) =>
    res
      .status(e.status || 503)
      .json({
        error: e instanceof CheckoutError || e.name === "ShippingError" ? e.code : "CHECKOUT_UNAVAILABLE",
        message:
          e instanceof CheckoutError || e.name === "ShippingError"
            ? e.message
            : "Unable to complete this request. Check your existing payment before paying again.",
      });
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      fail(res, e);
    }
  };
  // Quote-only session endpoint. Avoids requiring Paystack/Checkout 2.0 engine.
  // Requires the same authenticated customer session as all quote endpoints.
  router.get('/shipping/hybrid/account', (req,res)=>{
    res.json({customer:req.checkoutCustomer, quoteOnly:true});
  });
  router.get(
    "/account",
    wrap(async (req, res) => {
      const c = req.checkoutCustomer;
      const parts = await Promise.allSettled([
        store.wallet(c.id),
        store.addresses(c.id),
        store.pending(c.id),
        customerProfile ? customerProfile(c) : null,
      ]);
      const [wallet, addresses, pending, profile] = parts.map(p => p.status === 'fulfilled' ? p.value : null);
      res.json({
        serviceWarnings: parts.map((p,i)=>p.status === 'rejected' ? ['wallet','addresses','pending','profile'][i] : null).filter(Boolean),
        customer: { ...c },
        wallet,
        addresses: addresses || [],
        pending: (pending || []).map(engine.view),
        savedBilling:
          profile?.checkout_preferences?.savedBillingAddress || null,
        shippingAddress: profile?.shipping_address || null,
      });
    }),
  );
  router.post(
    "/quote",
    wrap(async (req, res) => res.json(await engine.quote(req.body?.lines))),
  );
  // Read-only courier quotes: does not change checkout totals or charge funds.
  router.post("/shipping/quotes", wrap(async (req,res) => {
    if (!shippingQuoteFlow) throw new CheckoutError("SHIPPING_NOT_CONFIGURED", "Delivery quotes are not available yet.", 503);
    res.json(await shippingQuoteFlow.quote({customer:{...req.checkoutCustomer,...require("./checkout-core.cjs").contact(req.body?.contact),name:`${req.body?.contact?.firstName || ""} ${req.body?.contact?.lastName || ""}`.trim()}, lines:req.body?.lines, destination:req.body?.destination}));
  }));
  // Estimates only. No payment or shipping booking can be triggered here.
  router.post('/shipping/hybrid/estimate',wrap(async(req,res)=>{
    if(!config.hybridDeliveryEnabled) throw new CheckoutError('HYBRID_NOT_ACTIVE','Hybrid delivery is not enabled.',503);
    const {estimate}=require('./hybrid-delivery.cjs');
    const db=config.hybridSupabase;
    res.json(await estimate({catalog,db})({lines:req.body?.lines,destination:req.body?.destination}));
  }));
  // No payment link here. Customer is clearly told to await an administrator quote.
  router.post('/shipping/hybrid/request',wrap(async(req,res)=>{
    if(!quoteRequests)throw new CheckoutError('FEATURE_DISABLED','Manual quote requests are disabled.',503);
    res.status(201).json(await quoteRequests.create({customerId:req.checkoutCustomer.id,lines:req.body?.lines,destination:req.body?.destination,recipient:req.body?.recipient}));
  }));
  router.get('/shipping/hybrid/requests',wrap(async(req,res)=>{
    if(!quoteRequests)throw new CheckoutError('FEATURE_DISABLED','Manual quote requests are disabled.',503);
    const requests = await quoteRequests.listCustomer(req.checkoutCustomer.id);
    // Two independent roll-out modes: existing single-quote merchant test, or
    // explicit public rollout for every admin-approved (QUOTE_READY) quotation.
    // The database still validates customer ownership, amount, status and expiry.
    const publicQuotePayments = config.quoteAllApprovedEnabled === true;
    const merchantTest = config.quoteMerchantTestEnabled === true && !!config.quoteMerchantTestEmail &&
      String(req.checkoutCustomer.email || '').trim().toLowerCase() === config.quoteMerchantTestEmail;
    const canPay = !!(engine && config.ready && config.mode === 'live' &&
      config.quotePaymentsEnabled === true && config.acceptNewOrders === true &&
      (publicQuotePayments || merchantTest || config.quoteTestId));
    const visible = requests.map(q => {
      const approved = publicQuotePayments || merchantTest ||
        (!!config.quoteTestId && String(q.id).toLowerCase() === config.quoteTestId);
      const validUntil = Date.parse(q.expiresAt || '');
      const expired = !Number.isFinite(validUntil) || validUntil <= Date.now();
      const amount = Number(q.totalKobo);
      let paymentUnavailableReason = null;
      if (!engine || !config.ready || config.mode !== 'live') paymentUnavailableReason = 'Live checkout is not ready.';
      else if (!config.quotePaymentsEnabled) paymentUnavailableReason = 'Quotation payments are disabled in Vercel.';
      else if (!config.acceptNewOrders) paymentUnavailableReason = 'New checkout orders are disabled in Vercel.';
      else if (!publicQuotePayments && !merchantTest && !config.quoteTestId) paymentUnavailableReason = 'The approved test quotation is not configured in Vercel.';
      else if (!approved) paymentUnavailableReason = 'This quotation is not approved for the controlled live test.';
      else if (q.status !== 'QUOTE_READY') paymentUnavailableReason = 'The delivery quotation is not ready.';
      else if (q.paymentStatus === 'paid') paymentUnavailableReason = 'Payment has already been completed.';
      else if (expired) paymentUnavailableReason = 'This quotation has expired.';
      else if (!Number.isSafeInteger(amount) || amount < 100) paymentUnavailableReason = 'The confirmed quotation amount is invalid.';
      return {...q, paymentEnabled: canPay && !paymentUnavailableReason,
        paymentUnavailableReason,
        availableMethods: {
          card: canPay && !paymentUnavailableReason,
          bank_transfer: canPay && !paymentUnavailableReason && config.bankTransferEnabled === true,
          wallet: canPay && !paymentUnavailableReason && config.quoteWalletEnabled === true,
        },
      };
    });
    // The list-level flag must reflect the server-authorized quotes. Previously
    // always false, so older storefronts hid checkout even for approved pilots.
    // Individual quote flags and POST /pay still enforce all authorization gates.
    res.json({requests:visible, paymentEnabled:visible.some(q => q.paymentEnabled === true), countryContext:resolveLocale(req)});
  }));
  // Live payment for an administrator-confirmed manual quote only.
  // Separate feature flag: ordinary courier checkout does not unlock this route.
  router.post('/shipping/hybrid/pay',wrap(async(req,res)=>{
    if(config.mode!=='live'||config.quotePaymentsEnabled!==true||!config.ready||!quoteRequests||!config.acceptNewOrders)
      throw new CheckoutError('PAYMENTS_LOCKED','GRIM quotation payments are not yet enabled.',503);
    const quoteId=String(req.body?.quoteId||'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(quoteId))
      throw new CheckoutError('INVALID_QUOTE_ID','Choose a valid confirmed quotation.',400);
    const merchantTest = config.quoteMerchantTestEnabled === true && !!config.quoteMerchantTestEmail &&
      String(req.checkoutCustomer.email || '').trim().toLowerCase() === config.quoteMerchantTestEmail;
    if(config.quoteAllApprovedEnabled !== true && !merchantTest &&
       (!config.quoteTestId || quoteId.toLowerCase() !== config.quoteTestId))
      throw new CheckoutError('TEST_QUOTE_ONLY','Live payment is currently restricted to the approved merchant test quotation.',403);
    const method = req.body?.method || 'card';
    if (!['card','bank_transfer','wallet'].includes(method))
      throw new CheckoutError('INVALID_METHOD','Choose card, bank transfer or GRIM Wallet.',400);
    res.json(await engine.startManualQuote({
      quoteId, customerId:req.checkoutCustomer.id, email:req.checkoutCustomer.email,
      method, bankTransferEnabled:config.bankTransferEnabled === true,
      walletCheckoutEnabled:config.quoteWalletEnabled === true,
    }));
  }));
  router.post(
    "/addresses",
    wrap(async (req, res) =>
      res.json({
        saved: await store.saveAddress(
          req.checkoutCustomer.id,
          address(req.body?.address),
        ),
      }),
    ),
  );
  router.post(
    "/start",
    wrap(async (req, res) => {
      // Merchant-owned quote test must not activate ordinary checkout.
      if (config.mode === 'live' && config.quoteTestId && !config.quoteAllApprovedEnabled)
        throw new CheckoutError('CONTROLLED_QUOTE_TEST_ONLY', 'Only the approved delivery quotation can start a payment during this test.', 403);
      res.json(
        await engine.start({
          ...req.body,
          customerId: req.checkoutCustomer.id,
          email: req.checkoutCustomer.email,
        }),
      );
    }),
  );
  router.post(
    "/confirm",
    wrap(async (req, res) =>
      res.json(
        await engine.confirm({
          reference: req.body?.reference,
          customerId: req.checkoutCustomer.id,
        }),
      ),
    ),
  );
  router.post('/wallet/cancel', wrap(async(req,res)=>res.json(await engine.closeWallet({reference:req.body?.reference,customerId:req.checkoutCustomer.id}))));
  router.post("/webhook", async (req, res) => {
    if (!engine) return res.sendStatus(503);
    if (
      !paystackSignatureIsValid(
        req.body,
        req.headers["x-paystack-signature"],
        config.secret,
        config.mode || "test",
      )
    )
      return res.sendStatus(401);
    let event;
    try {
      event = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.sendStatus(400);
    }
    if (
      event.event !== "charge.success" ||
      !refOK(event.data?.reference) ||
      event.data?.domain !== (config.mode || "test")
    )
      return res.sendStatus(200);
    try {
      const r = await engine.reconcile(event.data.reference);
      return res.sendStatus(r.status === "paid" ? 200 : 503);
    } catch (e) {
      return res.sendStatus(e.code === "NOT_FOUND" ? 200 : 503);
    }
  });
  return router;
}
module.exports = { createRoutes };

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
function createRoutes({
  catalog,
  sessionUser,
  config,
  store,
  provider,
  customerProfile,
  shippingQuoteFlow,
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
  router.get("/config", async (_req, res) => {
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
      currency: "NGN",
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
    if (!engine)
      return res
        .status(503)
        .json({
          error: "CHECKOUT_UNAVAILABLE",
          message: "Checkout configuration is incomplete.",
        });
    if (req.path === "/webhook") return next();
    let u;
    try { u = await sessionUser(req); } catch { return res.status(503).json({error:"ACCOUNT_UNAVAILABLE",message:"Your account could not be confirmed."}); }
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
    if (req.method !== "GET" && req.headers.origin !== config.base)
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
  router.get(
    "/account",
    wrap(async (req, res) => {
      const c = req.checkoutCustomer;
      const [wallet, addresses, pending, profile] = await Promise.all([
        store.wallet(c.id),
        store.addresses(c.id),
        store.pending(c.id),
        customerProfile ? customerProfile(c) : null,
      ]);
      res.json({
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
    wrap(async (req, res) =>
      res.json(
        await engine.start({
          ...req.body,
          customerId: req.checkoutCustomer.id,
          email: req.checkoutCustomer.email,
        }),
      ),
    ),
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

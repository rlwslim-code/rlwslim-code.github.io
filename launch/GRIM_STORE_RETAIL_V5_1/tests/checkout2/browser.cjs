const assert = require("node:assert/strict"),
  express = require("express"),
  path = require("node:path"),
  fs = require("node:fs"),
  { chromium } = require("playwright");
const { createShippingQuoteFlow } = require("../../src/checkout2/shipping-quote-flow.cjs");
const { createRoutes } = require("../../src/checkout2/routes.cjs"),
  { fixture, config, shipping } = require("./fixture.cjs");
async function run() {
  const f = await fixture(),
    app = express();
  let server, browser, page;
  const out = path.join(__dirname, "../../test-results");
  fs.mkdirSync(out, { recursive: true });
  let base = "",
    loggedIn = true,
    customerId = "browser-wallet",
    providerId = 1000;
  const provider = {
    initialize: async () => ({
      authorization_url: "https://checkout.paystack.com/browser-fixture",
    }),
    verify: async (ref) => {
      const row = await f.store.get(ref);
      return {
        id: providerId,
        domain: "test",
        status: "success",
        reference: ref,
        currency: "NGN",
        amount: row.quote.totalKobo,
        customer: { email: row.email },
      };
    },
  };
  app.use("/api/checkout2/webhook", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.get('/api/products',(_req,res)=>res.json([{id:1,name:'Veil Tee',price:18000,type:'Tee',color:'Veil',active:1}]));
  app.get('/api/market',(_req,res)=>res.json({country:'NG'}));
  app.get('/api/me',(_req,res)=>res.json(loggedIn ? {id:customerId,email:'browser@example.com',name:'Test Customer'} : null));

  app.post("/api/login", (_req, res) => {
    loggedIn = true;
    res.json({ ok: true });
  });
  const cfg = { ...config,shippingRequired:true };
  const shippingQuoteFlow=createShippingQuoteFlow({catalog:f.catalog,apiKey:'fixture-shipping-key',senderAddressCode:123,categoryId:789,signingSecret:'x'.repeat(48),packageMetrics:{'1':{weightKg:0.6},outerPackage:{length:30,width:25,height:10}},
    fetchImpl:async url=>({ok:true,json:async()=>({status:'success',data:url.endsWith('/address/123') ? {country_code:'NG',state:'Ekiti',city:'Oye-Ekiti'} : url.endsWith('/address/validate') ? {address_code:234,country_code:'NG'} : {request_token:'fixture-quote',couriers:[{courier_id:7,service_code:'fixture',courier_name:'Fixture Courier',rate_card_currency:'NGN',rate_card_amount:4200,service_type:'pickup',delivery_eta:'Fixture ETA'}]}})})});
  app.use(
    "/api/checkout2",
    createRoutes({
      catalog: f.catalog,
      shippingQuoteFlow,
      config: cfg,
      store: f.store,
      provider,
      sessionUser: () =>
        loggedIn
          ? {
              id: customerId,
              email: "browser@example.com",
              name: "Test Customer",
              phone: "+2348000000000",
            }
          : null,
    }),
  );
  app.use(express.static(path.join(__dirname, "../../public")));
  const errors = [];
  let checks = 0;
  try {
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;
    cfg.base = base;
    // Router creation used cfg by reference; engine callback does not affect local recovery tests.
    await f.db.query(
      "insert into grim2_wallet_accounts(customer_id,balance_kobo) values ($1,5000000)",
      [customerId],
    );
    await f.store.saveAddress(customerId, {
      ...shipping,
      address: "Saved Billing Road",
    });
    const bundledChromium = (await import("@sparticuz/chromium")).default;
    browser = await chromium.launch({
      headless: true,
      executablePath: await bundledChromium.executablePath(),
      args: bundledChromium.args.filter(a=>a!=='--disable-web-security'&&a!=='--allow-running-insecure-content'),
    });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      if(!localStorage.getItem("grimCart")) localStorage.setItem(
        "grimCart",
        JSON.stringify([{ id: 1, qty: 1, size: "M" }]),
      );
    });
    await page.goto(base + "/checkout2.html");
    await page.getByText("Review your delivery and billing details.").waitFor();
    assert.equal(await page.locator("#total").textContent(), "₦18,000.00");
    checks++;
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    checks++;
    await page.locator("#savedShipping").selectOption("0");
    assert.equal(
      await page.locator('[name="shippingAddress"]').inputValue(),
      "Saved Billing Road",
    );
    checks++;
    await page.locator("#billingSame").uncheck();
    await page.locator("#savedBilling").selectOption("0");
    assert.equal(
      await page.locator('[name="billingAddress"]').inputValue(),
      "Saved Billing Road",
    );
    checks++;
    assert.equal(await page.locator('#payButton').isDisabled(),true);checks++;
    await page.locator('#grim2FetchCouriers').click();
    await page.locator('input[name="grim2Courier"]').check();
    assert.equal(await page.locator('#total').textContent(),'₦22,200.00');checks++;
    await page.locator('[name="shippingApartment"]').fill('Unit 2');
    await page.locator('[name="shippingApartment"]').dispatchEvent('change');
    assert.equal(await page.locator('#payButton').isDisabled(),true);checks++;
    await page.locator('#grim2FetchCouriers').click();await page.locator('input[name="grim2Courier"]').check();
    await page.screenshot({
      path: path.join(out, "checkout-mobile.png"),
      fullPage: true,
    });
    await page.locator("#walletMethod").check();
    await page.locator("#payButton").click();
    await page.getByText(/Test payment confirmed/).waitFor();
    assert.equal((await f.store.wallet(customerId)).balanceKobo, 2780000);
    checks++;
    assert.equal(
      (
        await f.db.query(
          "select count(*)::int n from grim2_receipts where customer_id=$1",
          [customerId],
        )
      ).rows[0].n,
      1,
    );
    checks++;
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("grimCart"))),
      [],
    );
    checks++;
    // New browser session recovers a card attempt from server state, without local reference storage.
    customerId = "browser-card";
    const attempt = await f.engine.start({
      customerId,
      email: "browser@example.com",
      key: "browser_card_key_00001",
      expectedTotalKobo: 1800000,
      lines: [{ productId: "1", quantity: 1, size: "M" }],
      shipping,
      billing: shipping,
      contact: {
        firstName: "Test",
        lastName: "Customer",
        phone: "+2348000000000",
      },
    });
    await page.goto(base + "/checkout2.html");
    await page
      .getByText(
        "An unfinished checkout was found. Recover it before paying again.",
      )
      .waitFor();
    assert.equal(await page.locator("#payButton").isDisabled(), true);
    checks++;
    await page.getByRole("button", { name: "CHECK EXISTING PAYMENT" }).click();
    await page.getByText(/Test payment confirmed/).waitFor();
    assert.equal((await f.store.get(attempt.reference)).status, "paid");
    checks++;
    await page.evaluate(()=>localStorage.setItem('grimCart',JSON.stringify([{id:1,qty:1,size:'M'}])));
    await page.goto(base+'/checkout2.html?reference='+attempt.reference);
    await page.getByText(/Test payment confirmed/).waitFor();
    assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('grimCart'))))[0].qty,1);checks++;
    // Callback recovery after authentication runs even when no unpaid attempt remains.
    loggedIn = false;
    await page.goto(base + "/checkout2.html?reference=" + attempt.reference);
    await page.locator("#loginForm").waitFor({ state: "visible" });
    await page.locator('#loginForm [name="email"]').fill("browser@example.com");
    await page.locator('#loginForm [name="password"]').fill("fixtureonly");
    await page.locator("#loginForm button").click();
    await page.getByText(/Test payment confirmed/).waitFor();
    checks++;
    await page.evaluate(()=>localStorage.setItem("grimCart",JSON.stringify([{id:1,qty:1,size:"M"}])));
    // Malicious product text must render as text, never HTML.
    customerId = "browser-xss";
    await f.store.saveAddress(customerId, {
      ...shipping,
      address: "<img src=x onerror=alert(1)>",
    });
    await page.goto(base + "/checkout2.html");
    await page.getByText("Review your delivery and billing details.").waitFor();
    assert.equal(await page.locator("#savedShipping img").count(), 0);
    checks++;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({
      path: path.join(out, "checkout-desktop.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);checks++;
    // Exercise the real storefront product and bag entry point, then the full shipping and wallet UI.
    customerId='browser-fullflow';
    await f.db.query('insert into grim2_wallet_accounts(customer_id,balance_kobo) values ($1,5000000)',[customerId]);
    await page.evaluate(()=>localStorage.setItem('grimCart','[]'));
    await page.goto(base+'/shop.html');
    await page.waitForFunction(()=>window.openCheckout?.toString().includes('checkout2.html'));
    await page.getByRole('button',{name:'ADD TO CART 🛒'}).first().click();
    await page.getByRole('button',{name:'CHECKOUT SECURELY'}).click();
    await page.waitForURL('**/checkout2.html');await page.getByText('Review your delivery and billing details.').waitFor();checks++;
    await page.locator('[name="shippingAddress"]').fill('12 Fixture Road');
    await page.locator('[name="shippingCity"]').fill('Oye-Ekiti');await page.locator('[name="shippingState"]').fill('Ekiti');
    await page.locator('#grim2FetchCouriers').click();await page.locator('input[name="grim2Courier"]').check();
    await page.locator('#walletMethod').check();await page.locator('#payButton').click();await page.getByText(/Test payment confirmed/).waitFor();
    assert.equal((await f.store.wallet(customerId)).balanceKobo,2780000);assert.match(await page.locator('#receiptDetails').textContent(),/Fixture Courier/);checks++;
    await page.screenshot({path:path.join(out,'checkout-receipt.png'),fullPage:true});
    console.log(
      `Passed ${checks} browser checks: mobile layout, server totals, saved addresses, wallet order, recovery, callback sign-in and safe text rendering.`,
    );
    fs.writeFileSync(
      path.join(out, "browser-results.json"),
      JSON.stringify(
        { checks, errors, provider: "simulated; no external payments" },
        null,
        2,
      ),
    );
  } catch (e) {
    if (page) {
      console.error('Browser page state:', await page.locator('body').innerText());
      console.error('Browser errors:', errors);
      await page.screenshot({path:path.join(out,'browser-failure.png'),fullPage:true});
    }
    throw e;
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
    await f.close();
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

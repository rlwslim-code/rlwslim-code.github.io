/*
 * GRIM SECURE CHECKOUT OVERRIDE
 * --------------------------------
 * Keeps payment changes isolated from the main GRIM frontend.
 * Uses the server-side /api/payments/initialize endpoint.
 */

(function () {
  "use strict";

  const byId = id => document.getElementById(id);
  async function fetchWithTimeout(
  url,
  options = {},
  timeout = 20000
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}
  const value = id =>
    String(byId(id)?.value || "").trim();


  function paymentMessage(text) {
    const box = byId("paymentMessage");

    if (box) {
      box.textContent = text;
    }
  }


  function getCart() {
    try {
      if (
        typeof cart !== "undefined" &&
        Array.isArray(cart)
      ) {
        return cart;
      }
    } catch (_) {}

    return [];
  }


  /*
   * Get canonical GRIM prices from the backend.
   *
   * This is important because the storefront may display
   * another market/currency, while Paystack currently
   * initializes the secure transaction from GRIM's
   * canonical NGN product prices.
   */
  async function getCanonicalProducts() {
    const response = await fetchWithTimeout(
  "/api/products",
      {
        method: "GET",
        credentials: "include",
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        "Unable to load current GRIM prices."
      );
    }

    const products =
      await response.json();

    if (!Array.isArray(products)) {
      throw new Error(
        "GRIM product data is unavailable."
      );
    }

    return products;
  }


  async function calculateExpectedAmount(
    cartItems
  ) {
    const products =
      await getCanonicalProducts();

    const productMap =
      new Map(
        products.map(product => [
          Number(product.id),
          product
        ])
      );

    let amountNaira = 0;

    for (const item of cartItems) {
      const product =
        productMap.get(
          Number(item.id)
        );

      if (!product) {
        throw new Error(
          "One of the items in your bag is no longer available."
        );
      }

      const qty =
        Math.max(
          1,
          Number(item.qty || 1)
        );

      amountNaira +=
        Number(product.price || 0) *
        qty;
    }

    if (
      !Number.isFinite(amountNaira) ||
      amountNaira <= 0
    ) {
      throw new Error(
        "Your bag total could not be calculated."
      );
    }

    /*
     * Paystack API expects amount in kobo.
     */
    return Math.round(
      amountNaira * 100
    );
  }


  async function secureGrimPayment(
    method
  ) {
    const cartItems =
      getCart();


    if (!cartItems.length) {
      paymentMessage(
        "Your bag is empty."
      );

      return;
    }


    const customer = {
      email:
        value("coEmail"),

      firstName:
        value("coFirst"),

      lastName:
        value("coLast"),

      phone:
        value("coPhone")
    };


    const delivery = {
      country:
        value("coCountry") ||
        "NG",

      address:
        value("coAddress"),

      apartment:
        value("coApartment"),

      city:
        value("coCity"),

      state:
        value("coState"),

      postal:
        value("coPostal"),

      instructions:
        value("coInstructions")
    };

    const billingSame = byId("coBillingSame")?.checked !== false;
    const billing = billingSame ? {
      country: delivery.country,
      address: delivery.address,
      city: delivery.city,
      state: delivery.state,
      postal: delivery.postal
    } : {
      country: value("coCountry") || delivery.country,
      address: value("coBillingAddress"),
      city: value("coBillingCity"),
      state: value("coBillingState"),
      postal: value("coBillingPostal")
    };
    const saveCard = byId("coSaveCard")?.checked === true;

    if (!billing.address || !billing.city || !billing.state) {
      paymentMessage("Complete your billing address first.");
      return;
    }



    if (
      !customer.email ||
      !customer.firstName ||
      !customer.lastName ||
      !customer.phone
    ) {
      paymentMessage(
        "Complete your contact information first."
      );

      return;
    }


    if (
      !delivery.address ||
      !delivery.city ||
      !delivery.state
    ) {
      paymentMessage(
        "Complete your delivery address first."
      );

      return;
    }


    if (
      method === "bank_transfer" &&
      delivery.country !== "NG"
    ) {
      paymentMessage(
        "Bank transfer is currently available for Nigerian checkout only."
      );

      return;
    }


    paymentMessage(
      method === "bank_transfer"
        ? "Preparing secure bank transfer..."
        : "Preparing secure card payment..."
    );


    try {
      const expectedAmount =
        await calculateExpectedAmount(
          cartItems
        );


      const items =
        cartItems.map(item => ({
          id:
            Number(item.id),

          qty:
            Math.max(
              1,
              Number(item.qty || 1)
            ),

          size:
            String(
              item.size || "M"
            )
        }));


      const response =
  await fetchWithTimeout(
    "/api/payments/initialize",
          {
            method:
              "POST",

            credentials:
              "include",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                method,
                expectedAmount,
                customer,
                delivery,
                billing,
                saveCard,
                items
              })
          }
        );


      let result = {};

      try {
        result =
          await response.json();
      } catch (_) {}


      if (
        !response.ok ||
        !result?.authorizationUrl
      ) {
        console.error(
          "[GRIM PAYMENT]",
          response.status,
          result
        );

        paymentMessage(
  error?.name === "AbortError"
    ? "Payment preparation timed out. No payment was opened. Please try again."
    : error?.message ||
      "Unable to connect to secure payment. Please try again."
);

        return;
      }


     paymentMessage(
  "Opening secure Paystack checkout..."
);

try {
  sessionStorage.setItem(
    "grim_pending_payment_reference",
    result.reference
  );
} catch (_) {}

window.location.assign(
  result.authorizationUrl
); 

    } catch (error) {
      console.error(
        "[GRIM PAYMENT]",
        error
      );

      paymentMessage(
        error?.message ||
        "Unable to connect to secure payment. Please try again."
      );
    }
  }


  /*
   * Replace only the existing payment function.
   * Everything else in app.js remains untouched.
   */
  window.startGrimPayment =
    secureGrimPayment;


  console.log(
    "[GRIM CHECKOUT] Secure payment override loaded."
  );
})();

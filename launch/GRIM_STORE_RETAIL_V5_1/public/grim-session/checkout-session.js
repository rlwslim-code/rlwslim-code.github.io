/*
 * GRIM CHECKOUT TAB SESSION
 * --------------------------------------------------
 * Sign in once per browser tab.
 *
 * - Survives refreshes in the same tab
 * - Survives opening/closing the cart and checkout
 * - Clears when the browser tab/session ends
 * - Does NOT modify app.js
 * - Does NOT modify grim-frontend-stable.js
 * - Does NOT modify secure-payments.js
 */

(function () {
  "use strict";

  const SESSION_KEY = "grim_checkout_tab_auth_v1";

  const $ = id =>
    document.getElementById(id);

  let pendingCheckout = false;


  // ==========================================
  // TAB SESSION
  // ==========================================

  function saveTabUser(user) {
    if (!user || !user.email) return false;

    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          id: user.id || null,
          name: user.name || "",
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          email: user.email || "",
          phone: user.phone || "",
          authorizedAt: Date.now()
        })
      );

      return true;
    } catch (_) {
      return false;
    }
  }


  function getTabUser() {
    try {
      const raw =
        sessionStorage.getItem(
          SESSION_KEY
        );

      if (!raw) return null;

      const user =
        JSON.parse(raw);

      if (
        !user ||
        !user.email
      ) {
        return null;
      }

      return user;

    } catch (_) {
      return null;
    }
  }


  function clearTabUser() {
    try {
      sessionStorage.removeItem(
        SESSION_KEY
      );
    } catch (_) {}
  }


  // ==========================================
  // CHECKOUT PREFILL
  // ==========================================

  function prefillCheckout(user) {
    if (!user) return;

    const email = $("coEmail");
    const first = $("coFirst");
    const last = $("coLast");
    const phone = $("coPhone");

    if (
      email &&
      user.email &&
      !email.value
    ) {
      email.value = user.email;
    }


    if (
      first &&
      user.firstName &&
      !first.value
    ) {
      first.value =
        user.firstName;
    }


    if (
      last &&
      user.lastName &&
      !last.value
    ) {
      last.value =
        user.lastName;
    }


    /*
     * Older accounts may only have a full name.
     */
    if (
      (!user.firstName ||
       !user.lastName) &&
      user.name
    ) {
      const parts =
        String(user.name)
          .trim()
          .split(/\s+/);

      if (
        first &&
        !first.value
      ) {
        first.value =
          parts.shift() || "";
      }

      if (
        last &&
        !last.value
      ) {
        last.value =
          parts.join(" ");
      }
    }


    if (
      phone &&
      user.phone &&
      !phone.value
    ) {
      phone.value =
        user.phone;
    }
  }


  // ==========================================
  // SIGN-IN SCREEN FOR CHECKOUT
  // ==========================================

  function requireCheckoutLogin() {
    pendingCheckout = true;

    try {
      window.closeBag?.();
    } catch (_) {
      $("bag")?.classList.remove(
        "open"
      );
    }


    if (
      typeof window.setMode ===
      "function"
    ) {
      window.setMode("login");
    }


    const message = $("aMsg");

    if (message) {
      message.textContent =
        "SIGN IN ONCE TO CONTINUE CHECKOUT IN THIS TAB.";
    }


    $("auth")?.classList.add(
      "open"
    );
  }


  // ==========================================
  // WATCH AUTH RESPONSES
  // ==========================================

  const originalFetch =
    window.fetch.bind(window);


  window.fetch = async function (
    input,
    init
  ) {

    const response =
      await originalFetch(
        input,
        init
      );


    try {
      let url;

      if (
        typeof input === "string"
      ) {
        url =
          new URL(
            input,
            window.location.href
          );
      }

      else if (
        input instanceof Request
      ) {
        url =
          new URL(
            input.url,
            window.location.href
          );
      }


      const path =
        url?.pathname || "";


      // --------------------------
      // Successful login/signup
      // --------------------------

      if (
        response.ok &&
        (
          path === "/api/login" ||
          path === "/api/register" ||
          path === "/api/auth/google"
        )
      ) {

        const clone =
          response.clone();

        const result =
          await clone.json();


        if (
          result &&
          result.email
        ) {

          saveTabUser(result);


          const account =
            $("acct");

          if (account) {
            const label =
              result.name ||
              result.email
                .split("@")[0];

            account.textContent =
              String(label)
                .toUpperCase();
          }


          /*
           * Customer originally clicked checkout,
           * then signed in.
           *
           * Continue automatically.
           */

          if (pendingCheckout) {

            pendingCheckout =
              false;

            setTimeout(() => {

              $("auth")
                ?.classList
                .remove("open");

              window.openCheckout?.();

            }, 350);
          }
        }
      }


      // --------------------------
      // Explicit logout
      // --------------------------

      if (
        response.ok &&
        path === "/api/logout"
      ) {
        clearTabUser();
        pendingCheckout = false;
      }


    } catch (error) {

      /*
       * Session helper must NEVER interrupt
       * the customer's normal request.
       */

      console.warn(
        "[GRIM SESSION]",
        error
      );
    }


    return response;
  };


  // ==========================================
  // OVERRIDE CHECKOUT AUTH GATE ONLY
  // ==========================================

  window.openCheckout =
    async function () {

      try {

        if (
          typeof cart !==
            "undefined" &&
          !cart.length
        ) {
          return;
        }

      } catch (_) {}


      /*
       * Do NOT call /api/me every time.
       *
       * The customer has already authenticated
       * during this browser-tab session.
       */

      const user =
        getTabUser();


      if (!user) {
        requireCheckoutLogin();
        return;
      }


      pendingCheckout = false;


      try {
        window.closeBag?.();
      } catch (_) {
        $("bag")
          ?.classList
          .remove("open");
      }


      /*
       * Build checkout only if needed.
       */

      if (
        !$("grimCheckoutForm") &&
        typeof window.buildGrimCheckout ===
          "function"
      ) {
        window.buildGrimCheckout();
      }


      prefillCheckout(user);


      const form =
        $("grimCheckoutForm");

      const payment =
        $("paymentStep");


      if (form) {
        form.style.display =
          "block";
      }


      if (payment) {
        payment.style.display =
          "none";
      }


      $("checkout")
        ?.classList
        .add("open");
    };


  // ==========================================
  // OPTIONAL PUBLIC CONTROL
  // ==========================================

  window.GRIMCheckoutSession = {

    isAuthorized() {
      return !!getTabUser();
    },

    currentUser() {
      return getTabUser();
    },

    clear() {
      clearTabUser();
    }

  };


  console.log(
    "[GRIM SESSION] Per-tab checkout session loaded."
  );

})();

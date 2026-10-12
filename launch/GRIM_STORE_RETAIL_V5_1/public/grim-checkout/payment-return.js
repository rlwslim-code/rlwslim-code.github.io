/*
 * GRIM PAYSTACK RETURN + PAID ORDER CONFIRMATION
 * ------------------------------------------------
 * Runs only when Paystack returns the customer to:
 * /?grim-payment=return
 *
 * The backend remains the authority:
 * - verifies the Paystack transaction
 * - validates signed order metadata
 * - stores the paid order idempotently
 */
(function () {
  "use strict";

  const PENDING_REFERENCE_KEY =
    "grim_pending_payment_reference";

  function escapeHTML(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cleanReturnURL() {
    try {
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );
    } catch (_) {}
  }

  function clearCartAfterPaidOrder() {
    try {
      localStorage.setItem("grimCart", "[]");
    } catch (_) {}

    try {
      if (typeof cart !== "undefined") {
        cart = [];
      }
      if (typeof save === "function") {
        save();
      }
      if (typeof draw === "function") {
        draw();
      }
    } catch (_) {}
  }

  function showPanel({
    title,
    message,
    reference = "",
    orderId = "",
    success = false
  }) {
    document.getElementById("grimPaymentReturnPanel")?.remove();

    const panel = document.createElement("div");
    panel.id = "grimPaymentReturnPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    panel.innerHTML = `
      <div style="
        width:min(92vw,520px);
        background:#0b0b0d;
        color:#fff;
        border:1px solid rgba(255,255,255,.14);
        border-radius:22px;
        padding:28px;
        box-shadow:0 25px 80px rgba(0,0,0,.55);
        font-family:inherit;
      ">
        <div style="
          font-size:12px;
          letter-spacing:.22em;
          opacity:.65;
          margin-bottom:12px;
        ">GRIM SECURE CHECKOUT</div>

        <h2 style="
          margin:0 0 12px;
          font-size:28px;
          line-height:1.1;
        ">${escapeHTML(title)}</h2>

        <p style="
          margin:0 0 18px;
          line-height:1.65;
          color:#c9c9ce;
        ">${escapeHTML(message)}</p>

        ${orderId ? `
          <p style="margin:8px 0;color:#fff">
            Order: <strong>#${escapeHTML(orderId)}</strong>
          </p>
        ` : ""}

        ${reference ? `
          <p style="
            margin:8px 0 22px;
            font-size:12px;
            line-height:1.5;
            word-break:break-all;
            color:#94949b;
          ">
            Reference: ${escapeHTML(reference)}
          </p>
        ` : ""}

        <button id="grimPaymentReturnClose" style="
          width:100%;
          border:0;
          border-radius:13px;
          padding:15px 18px;
          font-weight:800;
          letter-spacing:.08em;
          cursor:pointer;
          color:#fff;
          background:${success
            ? "linear-gradient(90deg,#7b123d,#5134d8)"
            : "#25252a"};
        ">
          ${success ? "CONTINUE SHOPPING" : "CLOSE"}
        </button>
      </div>
    `;

    Object.assign(panel.style, {
      position: "fixed",
      inset: "0",
      zIndex: "999999",
      display: "grid",
      placeItems: "center",
      padding: "20px",
      background: "rgba(0,0,0,.78)",
      backdropFilter: "blur(10px)"
    });

    document.body.appendChild(panel);

    document
      .getElementById("grimPaymentReturnClose")
      ?.addEventListener("click", () => {
        panel.remove();
      });
  }

  async function verifyReturnedPayment(reference) {
    showPanel({
      title: "VERIFYING PAYMENT",
      message:
        "GRIM is confirming the transaction with Paystack. Do not pay again while this check is running.",
      reference
    });

    try {
      const response = await fetch(
        "/api/payments/verify",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            reference
          })
        }
      );

      let result = {};

      try {
        result = await response.json();
      } catch (_) {}

      /*
       * A payment can be confirmed by Paystack even if order
       * persistence temporarily fails. Never tell the customer
       * to pay again in that case.
       */
      if (
        result?.verified === true &&
        result?.orderStored === false
      ) {
        cleanReturnURL();

        showPanel({
          title: "PAYMENT RECEIVED",
          message:
            "Your payment was confirmed, but GRIM could not finish syncing the order automatically. Do not pay again. Keep this reference and contact Customer Care.",
          reference,
          success: false
        });

        return;
      }

      if (
        response.ok &&
        result?.verified === true &&
        result?.orderStored !== false
      ) {
        try {
          sessionStorage.removeItem(
            PENDING_REFERENCE_KEY
          );
        } catch (_) {}

        clearCartAfterPaidOrder();
        cleanReturnURL();

        showPanel({
          title: "ORDER CONFIRMED",
          message:
            "Payment verified. Your GRIM order has been recorded successfully.",
          reference,
          orderId: result.orderId || "",
          success: true
        });

        return;
      }

      cleanReturnURL();

      showPanel({
        title: "PAYMENT NOT CONFIRMED",
        message:
          result?.error ||
          "GRIM could not confirm this transaction yet. Do not submit another payment until you check the reference with Customer Care.",
        reference
      });
    } catch (error) {
      console.error(
        "[GRIM PAYMENT RETURN]",
        error
      );

      cleanReturnURL();

      showPanel({
        title: "PAYMENT CHECK INTERRUPTED",
        message:
          "The verification request could not finish. Do not pay again. Keep the payment reference and contact GRIM Customer Care.",
        reference
      });
    }
  }

  const params =
    new URLSearchParams(
      window.location.search
    );

  const state =
    params.get("grim-payment");

  if (state === "cancel") {
    try {
      sessionStorage.removeItem(
        PENDING_REFERENCE_KEY
      );
    } catch (_) {}

    cleanReturnURL();

    showPanel({
      title: "PAYMENT CANCELLED",
      message:
        "No new GRIM order was confirmed. Your bag has been kept so you can try again."
    });

    return;
  }

  if (state !== "return") {
    return;
  }

  let reference =
    params.get("reference") ||
    params.get("trxref") ||
    "";

  if (!reference) {
    try {
      reference =
        sessionStorage.getItem(
          PENDING_REFERENCE_KEY
        ) || "";
    } catch (_) {}
  }

  if (!reference) {
    cleanReturnURL();

    showPanel({
      title: "REFERENCE MISSING",
      message:
        "GRIM returned from Paystack without a payment reference. Do not pay again if money left your account. Contact Customer Care with your Paystack receipt."
    });

    return;
  }

  verifyReturnedPayment(reference);
})();

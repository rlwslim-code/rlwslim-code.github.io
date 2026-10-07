/*
 * ============================================================
 * GRIM CONTROL CENTER
 * Admin Frontend
 * ============================================================
 *
 * This file is isolated from the customer storefront.
 *
 * It handles:
 * - Admin login/logout
 * - Dashboard statistics
 * - Online customers
 * - Signup activity
 * - Login / logout / last-seen activity
 * - Orders
 * - Payments
 * - Support messages
 * - Notifications
 * - Product overview
 * - Safe store settings
 *
 * Backend data will come from:
 * GET  /api/admin/control/snapshot
 * PUT  /api/admin/control/settings
 * POST /api/admin/control/notifications/read
 */

(function () {
  "use strict";

  /* =========================================================
     HELPERS
  ========================================================= */

  const $ = (id) =>
    document.getElementById(id);

  const state = {
    authenticated: false,

    snapshot: null,

    customers: [],
    orders: [],
    activities: [],
    payments: [],
    support: [],
    notifications: [],
    products: [],

    lastNotificationIds:
      new Set(),

    firstLoad: true,

    refreshTimer: null
  };


  function safeString(value) {
    return String(
      value ?? ""
    );
  }


  function escapeHtml(value) {
    return safeString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }


  function show(element) {
    if (!element) return;

    element.classList.remove(
      "hidden"
    );
  }


  function hide(element) {
    if (!element) return;

    element.classList.add(
      "hidden"
    );
  }


  function setText(
    element,
    text
  ) {
    if (!element) return;

    element.textContent =
      text ?? "";
  }


  function formatNumber(value) {
    const number =
      Number(value || 0);

    return new Intl.NumberFormat(
      "en-US"
    ).format(number);
  }


  function formatMoney(
    value,
    currency = "NGN"
  ) {
    const amount =
      Number(value || 0);

    try {
      return new Intl.NumberFormat(
        "en-NG",
        {
          style: "currency",
          currency:
            currency || "NGN",

          maximumFractionDigits:
            currency === "NGN"
              ? 0
              : 2
        }
      ).format(amount);

    } catch (_) {
      return `${currency} ${amount}`;
    }
  }


  function formatDate(value) {
    if (!value) {
      return "—";
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "—";
    }

    return new Intl.DateTimeFormat(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }
    ).format(date);
  }


  function formatTime(value) {
    if (!value) {
      return "";
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "";
    }

    return new Intl.DateTimeFormat(
      "en-US",
      {
        hour: "numeric",
        minute: "2-digit"
      }
    ).format(date);
  }


  function relativeTime(value) {
    if (!value) return "—";

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "—";
    }

    const seconds =
      Math.floor(
        (
          Date.now() -
          date.getTime()
        ) / 1000
      );

    if (seconds < 10) {
      return "just now";
    }

    if (seconds < 60) {
      return `${seconds}s ago`;
    }

    const minutes =
      Math.floor(
        seconds / 60
      );

    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    const hours =
      Math.floor(
        minutes / 60
      );

    if (hours < 24) {
      return `${hours}h ago`;
    }

    const days =
      Math.floor(
        hours / 24
      );

    return `${days}d ago`;
  }


  /* =========================================================
     API
  ========================================================= */

  async function api(
    path,
    options = {}
  ) {
    const config = {
      method:
        options.method ||
        "GET",

      credentials:
        "include",

      cache:
        "no-store",

      headers: {
        ...(options.body
          ? {
              "Content-Type":
                "application/json"
            }
          : {}),

        ...(options.headers || {})
      }
    };


    if (
      options.body !==
      undefined
    ) {
      config.body =
        typeof options.body ===
        "string"
          ? options.body
          : JSON.stringify(
              options.body
            );
    }


    const response =
      await fetch(
        path,
        config
      );


    let data = {};

    try {
      data =
        await response.json();
    } catch (_) {}


    if (!response.ok) {

      const error =
        new Error(
          data?.error ||
          data?.message ||
          `Request failed (${response.status})`
        );

      error.status =
        response.status;

      error.data =
        data;

      throw error;
    }


    return data;
  }


  /* =========================================================
     CONNECTION STATUS
  ========================================================= */

  function setConnection(
    status,
    text
  ) {
    const element =
      $("connectionStatus");

    if (!element) return;

    element.classList.remove(
      "online",
      "offline"
    );

    if (status) {
      element.classList.add(
        status
      );
    }

    element.textContent =
      text;
  }


  /* =========================================================
     TOAST
  ========================================================= */

  let toastTimer = null;


  function toast(
    message,
    duration = 3500
  ) {
    const element =
      $("adminToast");

    if (!element) return;

    clearTimeout(
      toastTimer
    );

    element.textContent =
      message;

    show(element);


    toastTimer =
      setTimeout(() => {
        hide(element);
      }, duration);
  }


  /* =========================================================
     BROWSER NOTIFICATIONS
  ========================================================= */

  async function enableNotifications() {

    if (
      !(
        "Notification" in
        window
      )
    ) {
      return;
    }


    if (
      Notification.permission ===
      "default"
    ) {
      try {
        await Notification
          .requestPermission();
      } catch (_) {}
    }
  }


  function browserNotify(
    title,
    body
  ) {
    if (
      !(
        "Notification" in
        window
      )
    ) {
      return;
    }


    if (
      Notification.permission !==
      "granted"
    ) {
      return;
    }


    try {

      new Notification(
        title || "GRIM",
        {
          body:
            body || ""
        }
      );

    } catch (_) {}
  }


  /* =========================================================
     LOGIN / LOGOUT
  ========================================================= */

  function showLogin() {
    state.authenticated =
      false;

    show(
      $("adminLogin")
    );

    hide(
      $("adminApp")
    );

    stopAutoRefresh();
  }


  function showDashboard() {
    state.authenticated =
      true;

    hide(
      $("adminLogin")
    );

    show(
      $("adminApp")
    );

    startAutoRefresh();
  }


  async function checkAdminStatus() {

    try {

      const result =
        await api(
          "/api/admin/status"
        );


      const authenticated =
        result?.loggedIn === true ||
        result?.authenticated === true ||
        result?.admin === true;


      if (!authenticated) {
        showLogin();
        return false;
      }


      showDashboard();

      return true;

    } catch (_) {

      showLogin();

      return false;
    }
  }


  async function loginAdmin(
  email,
  password
) {
    const message =
      $("adminLoginMessage");


    setText(
      message,
      "Authenticating…"
    );


    message?.classList.remove(
      "error",
      "success"
    );


    try {

      await api(
        "/api/admin/login",
        {
          method:
            "POST",

          body: {
  email,
  password
}
 }
);


      message?.classList.add(
        "success"
      );


      setText(
        message,
        "Access granted."
      );


      showDashboard();

      await enableNotifications();

      await loadDashboard(
        true
      );


      if (
        $("adminPassword")
      ) {
        $("adminPassword").value =
          "";
      }

    } catch (error) {

      message?.classList.add(
        "error"
      );


      setText(
        message,
        error?.message ||
        "Access denied."
      );
    }
  }


  async function logoutAdmin() {

    try {

      await api(
        "/api/admin/logout",
        {
          method:
            "POST"
        }
      );

    } catch (_) {}


    state.snapshot =
      null;

    state.firstLoad =
      true;

    state.lastNotificationIds
      .clear();


    showLogin();
  }


  /* =========================================================
     NAVIGATION
  ========================================================= */

  const panelTitles = {
    overview:
      "Overview",

    activity:
      "Live Activity",

    customers:
      "Customers",

    orders:
      "Orders",

    payments:
      "Payments",

    support:
      "Customer Care",

    store:
      "Store Control",

    notifications:
      "Notifications"
  };


  function openPanel(
    name
  ) {

    document
      .querySelectorAll(
        ".panel"
      )
      .forEach(panel => {
        panel.classList.remove(
          "active"
        );
      });


    document
      .querySelectorAll(
        ".nav-item"
      )
      .forEach(button => {
        button.classList.remove(
          "active"
        );
      });


    const panel =
      $(
        `panel-${name}`
      );


    panel?.classList.add(
      "active"
    );


    const button =
      document.querySelector(
        `.nav-item[data-panel="${name}"]`
      );


    button?.classList.add(
      "active"
    );


    setText(
      $("panelTitle"),
      panelTitles[name] ||
      "Control Center"
    );


    try {
      history.replaceState(
        null,
        "",
        `#${name}`
      );
    } catch (_) {}
  }


  /* =========================================================
     DASHBOARD DATA
  ========================================================= */

  async function loadDashboard(
    force = false
  ) {

    if (
      !state.authenticated
    ) {
      return;
    }


    setConnection(
      null,
      "Syncing…"
    );


    try {

      const snapshot =
        await api(
          "/api/admin/control/snapshot"
        );


      state.snapshot =
        snapshot;


      state.customers =
        Array.isArray(
          snapshot?.customers
        )
          ? snapshot.customers
          : [];


      state.orders =
        Array.isArray(
          snapshot?.orders
        )
          ? snapshot.orders
          : [];


      state.activities =
        Array.isArray(
          snapshot?.activity
        )
          ? snapshot.activity
          : [];


      state.payments =
        Array.isArray(
          snapshot?.payments
        )
          ? snapshot.payments
          : [];


      state.support =
        Array.isArray(
          snapshot?.support
        )
          ? snapshot.support
          : [];


      state.notifications =
        Array.isArray(
          snapshot?.notifications
        )
          ? snapshot.notifications
          : [];


      state.products =
        Array.isArray(
          snapshot?.products
        )
          ? snapshot.products
          : [];


      renderEverything();


      detectNewNotifications();


      state.firstLoad =
        false;


      setConnection(
        "online",
        "Live"
      );


      if (force) {
        toast(
          "GRIM Control Center updated."
        );
      }

    } catch (error) {

      if (
        error?.status === 401 ||
        error?.status === 403
      ) {

        showLogin();

        return;
      }


      console.error(
        "[GRIM ADMIN]",
        error
      );


      setConnection(
        "offline",
        "Connection problem"
      );


      if (force) {
        toast(
          error?.message ||
          "Unable to update dashboard."
        );
      }
    }
  }


  /* =========================================================
     STATS
  ========================================================= */

  function renderStats() {

    const stats =
      state.snapshot?.stats ||
      {};


    setText(
      $("statOnline"),
      formatNumber(
        stats.onlineNow ??
        stats.online ??
        0
      )
    );


    setText(
      $("statCustomers"),
      formatNumber(
        stats.totalCustomers ??
        stats.customers ??
        state.customers.length
      )
    );


    setText(
      $("statSignups"),
      formatNumber(
        stats.signupsToday ??
        0
      )
    );


    setText(
      $("statOrders"),
      formatNumber(
        stats.ordersToday ??
        0
      )
    );


    setText(
      $("statRevenue"),
      formatMoney(
        stats.revenueToday ??
        0,

        stats.currency ||
        "NGN"
      )
    );


    setText(
      $("statPending"),
      formatNumber(
        stats.pendingOrders ??
        0
      )
    );
  }


  /* =========================================================
     ACTIVITY
  ========================================================= */

  function activityIcon(
    eventType
  ) {

    const type =
      safeString(eventType)
        .toLowerCase();


    if (
      type.includes(
        "signup"
      )
    ) {
      return "＋";
    }


    if (
      type.includes(
        "login"
      )
    ) {
      return "↳";
    }


    if (
      type.includes(
        "logout"
      ) ||
      type.includes(
        "session_end"
      )
    ) {
      return "↲";
    }


    if (
      type.includes(
        "order"
      )
    ) {
      return "□";
    }


    if (
      type.includes(
        "payment"
      )
    ) {
      return "₦";
    }


    if (
      type.includes(
        "support"
      )
    ) {
      return "?";
    }


    if (
      type.includes(
        "error"
      )
    ) {
      return "!";
    }


    return "•";
  }


  function activityMarkup(
    activity
  ) {

    return `
      <div class="activity-item">

        <div class="activity-icon">
          ${escapeHtml(
            activityIcon(
              activity.event_type ||
              activity.eventType
            )
          )}
        </div>

        <div class="activity-content">

          <strong>
            ${escapeHtml(
              activity.title ||
              activity.event_type ||
              "Website activity"
            )}
          </strong>

          <span>
            ${escapeHtml(
              activity.message ||
              activity.email ||
              ""
            )}
          </span>

        </div>

        <div class="activity-time">
          ${escapeHtml(
            relativeTime(
              activity.created_at ||
              activity.createdAt
            )
          )}
        </div>

      </div>
    `;
  }


  function renderActivity() {

    const main =
      $("activityFeed");

    const overview =
      $("overviewActivity");


    if (
      !state.activities.length
    ) {

      const empty =
        `
          <p class="empty-state">
            No activity recorded yet.
          </p>
        `;


      if (main) {
        main.innerHTML =
          empty;
      }


      if (overview) {
        overview.innerHTML =
          empty;
      }


      return;
    }


    if (main) {

      main.innerHTML =
        state.activities
          .map(
            activityMarkup
          )
          .join("");
    }


    if (overview) {

      overview.innerHTML =
        state.activities
          .slice(0, 7)
          .map(
            activityMarkup
          )
          .join("");
    }
  }


  /* =========================================================
     CUSTOMERS
  ========================================================= */

  function customerStatus(
    customer
  ) {

    const online =
      customer.online === true ||
      customer.is_online === true ||
      customer.isOnline === true;


    return online
      ? `
          <span class="status-pill online">
            Online
          </span>
        `
      : `
          <span class="status-pill offline">
            Offline
          </span>
        `;
  }


  function renderCustomers() {

    const body =
      $("customerTableBody");


    if (!body) return;


    const query =
      safeString(
        $("customerSearch")
          ?.value
      )
        .trim()
        .toLowerCase();


    const rows =
      state.customers.filter(
        customer => {

          if (!query) {
            return true;
          }


          return [
            customer.name,
            customer.email,
            customer.phone
          ]
            .join(" ")
            .toLowerCase()
            .includes(query);
        }
      );


    if (!rows.length) {

      body.innerHTML =
        `
          <tr>
            <td colspan="6">
              No customers found.
            </td>
          </tr>
        `;

      return;
    }


    body.innerHTML =
      rows
        .map(customer => {

          return `
            <tr>

              <td>
                ${escapeHtml(
                  customer.name ||
                  "—"
                )}
              </td>

              <td>
                ${escapeHtml(
                  customer.email ||
                  "—"
                )}
              </td>

              <td>
                ${customerStatus(
                  customer
                )}
              </td>

              <td>
                ${escapeHtml(
                  formatDate(
                    customer.created_at ||
                    customer.signup_at ||
                    customer.signupAt
                  )
                )}
              </td>

              <td>
                ${escapeHtml(
                  formatDate(
                    customer.last_login_at ||
                    customer.lastLoginAt
                  )
                )}
              </td>

              <td>
                ${escapeHtml(
                  relativeTime(
                    customer.last_seen_at ||
                    customer.lastSeenAt
                  )
                )}
              </td>

            </tr>
          `;
        })
        .join("");
  }


  /* =========================================================
     ORDERS
  ========================================================= */

  function normalizeStatus(
    value
  ) {
    return safeString(
      value || "pending"
    )
      .trim()
      .toLowerCase();
  }


  function statusPill(
    value
  ) {

    const status =
      normalizeStatus(
        value
      );


    const safeClass =
      status.replace(
        /[^a-z0-9_-]/g,
        ""
      );


    return `
      <span
        class="status-pill ${safeClass}"
      >
        ${escapeHtml(
          status
        )}
      </span>
    `;
  }


  function renderOrders() {

    const body =
      $("orderTableBody");


    if (!body) return;


    const filter =
      $("orderFilter")
        ?.value ||
      "all";


    let orders =
      state.orders;


    if (
      filter !== "all"
    ) {

      orders =
        orders.filter(order => {

          const payment =
            normalizeStatus(
              order.payment_status ||
              order.paymentStatus
            );


          const delivery =
            normalizeStatus(
              order.delivery_status ||
              order.status ||
              order.deliveryStatus
            );


          return (
            payment === filter ||
            delivery === filter
          );
        });
    }


    if (!orders.length) {

      body.innerHTML =
        `
          <tr>
            <td colspan="6">
              No orders found.
            </td>
          </tr>
        `;

    } else {

      body.innerHTML =
        orders
          .map(order => {

            return `
              <tr>

                <td>
                  #${escapeHtml(
                    order.id ||
                    order.order_id ||
                    "—"
                  )}
                </td>

                <td>

                  <strong>
                    ${escapeHtml(
                      order.name ||
                      order.customer_name ||
                      "Customer"
                    )}
                  </strong>

                  <br>

                  <small>
                    ${escapeHtml(
                      order.email ||
                      ""
                    )}
                  </small>

                </td>

                <td>
                  ${escapeHtml(
                    formatMoney(
                      order.total ||
                      order.amount ||
                      0,

                      order.currency ||
                      "NGN"
                    )
                  )}
                </td>

                <td>
                  ${statusPill(
                    order.payment_status ||
                    order.paymentStatus ||
                    "pending"
                  )}
                </td>

                <td>
                  ${statusPill(
                    order.delivery_status ||
                    order.status ||
                    "pending"
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    formatDate(
                      order.created_at ||
                      order.createdAt
                    )
                  )}
                </td>

              </tr>
            `;
          })
          .join("");
    }


    renderRecentOrders();
  }


  function renderRecentOrders() {

    const container =
      $("overviewOrders");


    if (!container) return;


    if (
      !state.orders.length
    ) {

      container.innerHTML =
        `
          <p class="empty-state">
            No recent orders.
          </p>
        `;

      return;
    }


    container.innerHTML =
      state.orders
        .slice(0, 6)
        .map(order => {

          return `
            <div class="compact-row">

              <strong>
                Order #${escapeHtml(
                  order.id ||
                  order.order_id ||
                  "—"
                )}
              </strong>

              <div>
                ${escapeHtml(
                  order.name ||
                  order.email ||
                  "Customer"
                )}
              </div>

              <div>
                ${escapeHtml(
                  formatMoney(
                    order.total ||
                    order.amount ||
                    0,

                    order.currency ||
                    "NGN"
                  )
                )}
              </div>

            </div>
          `;
        })
        .join("");
  }


  /* =========================================================
     PAYMENTS
  ========================================================= */

  function renderPayments() {

    const container =
      $("paymentActivity");


    if (!container) return;


    if (
      !state.payments.length
    ) {

      container.innerHTML =
        `
          <p class="empty-state">
            No payment activity yet.
          </p>
        `;

      return;
    }


    container.innerHTML =
      state.payments
        .map(payment => {

          const status =
            normalizeStatus(
              payment.status ||
              payment.payment_status
            );


          return `
            <div class="activity-item">

              <div class="activity-icon">
                ₦
              </div>

              <div class="activity-content">

                <strong>
                  ${escapeHtml(
                    payment.title ||
                    (
                      status ===
                      "success"
                        ? "Payment received"
                        : "Payment activity"
                    )
                  )}
                </strong>

                <span>
                  ${escapeHtml(
                    payment.reference ||
                    payment.message ||
                    ""
                  )}
                </span>

              </div>

              <div class="activity-time">
                ${escapeHtml(
                  formatMoney(
                    payment.amount ||
                    0,

                    payment.currency ||
                    "NGN"
                  )
                )}
              </div>

            </div>
          `;
        })
        .join("");
  }


  /* =========================================================
     SUPPORT
  ========================================================= */

  function renderSupport() {

    const container =
      $("supportTickets");


    if (!container) return;


    if (
      !state.support.length
    ) {

      container.innerHTML =
        `
          <p class="empty-state">
            No customer-care messages.
          </p>
        `;

      return;
    }


    container.innerHTML =
      state.support
        .map(ticket => {

          return `
            <article class="support-item">

              <strong>
                ${escapeHtml(
                  ticket.topic ||
                  "Customer Care"
                )}
              </strong>

              <p>
                ${escapeHtml(
                  ticket.message ||
                  ""
                )}
              </p>

              <small>
                ${escapeHtml(
                  ticket.name ||
                  ticket.email ||
                  "Customer"
                )}
                ·
                ${escapeHtml(
                  formatDate(
                    ticket.created_at ||
                    ticket.createdAt
                  )
                )}
              </small>

            </article>
          `;
        })
        .join("");
  }


  /* =========================================================
     NOTIFICATIONS
  ========================================================= */

  function unreadNotifications() {

    return state.notifications
      .filter(
        notification =>
          !(
            notification.read === true ||
            notification.read_at ||
            notification.readAt
          )
      );
  }


  function renderNotifications() {

    const container =
      $("notificationList");

    const badge =
      $("notificationBadge");


    const unread =
      unreadNotifications();


    if (badge) {

      if (unread.length) {

        badge.textContent =
          String(
            unread.length
          );

        show(badge);

      } else {

        hide(badge);
      }
    }


    if (!container) return;


    if (
      !state.notifications.length
    ) {

      container.innerHTML =
        `
          <p class="empty-state">
            No notifications yet.
          </p>
        `;

      return;
    }


    container.innerHTML =
      state.notifications
        .map(notification => {

          const unread =
            !(
              notification.read === true ||
              notification.read_at ||
              notification.readAt
            );


          return `
            <article
              class="notification-item
              ${unread
                ? "unread"
                : ""}"
            >

              <strong>
                ${escapeHtml(
                  notification.title ||
                  "GRIM activity"
                )}
              </strong>

              <p>
                ${escapeHtml(
                  notification.message ||
                  ""
                )}
              </p>

              <small>
                ${escapeHtml(
                  relativeTime(
                    notification.created_at ||
                    notification.createdAt
                  )
                )}
              </small>

            </article>
          `;
        })
        .join("");
  }


  function detectNewNotifications() {

    const currentIds =
      new Set();


    for (
      const notification
      of state.notifications
    ) {

      const id =
        safeString(
          notification.id ||
          notification.created_at ||
          notification.createdAt ||
          ""
        );


      if (!id) continue;


      currentIds.add(id);


      if (
        !state.firstLoad &&
        !state.lastNotificationIds
          .has(id)
      ) {

        const title =
          notification.title ||
          "New GRIM activity";


        const message =
          notification.message ||
          "";


        toast(
          `${title}${
            message
              ? ` — ${message}`
              : ""
          }`
        );


        browserNotify(
          title,
          message
        );
      }
    }


    state.lastNotificationIds =
      currentIds;
  }


  async function markNotificationsRead() {

    try {

      await api(
        "/api/admin/control/notifications/read",
        {
          method:
            "POST"
        }
      );


      await loadDashboard();


      toast(
        "Notifications marked as read."
      );

    } catch (error) {

      toast(
        error?.message ||
        "Unable to update notifications."
      );
    }
  }


  /* =========================================================
     PRODUCTS
  ========================================================= */

  function renderProducts() {

    const container =
      $("productManager");


    if (!container) return;


    if (
      !state.products.length
    ) {

      container.innerHTML =
        `
          <p class="empty-state">
            No products loaded.
          </p>
        `;

      return;
    }


    container.innerHTML =
      state.products
        .map(product => {

          return `
            <div class="compact-row">

              <strong>
                ${escapeHtml(
                  product.name ||
                  product.title ||
                  `Product ${product.id}`
                )}
              </strong>

              <div>
                ${escapeHtml(
                  formatMoney(
                    product.price ||
                    0,

                    product.currency ||
                    "NGN"
                  )
                )}
              </div>

              <small>
                ${product.active === false
                  ? "Hidden"
                  : "Visible"}
              </small>

            </div>
          `;
        })
        .join("");
  }


  /* =========================================================
     STORE SETTINGS
  ========================================================= */

  function renderSettings() {

    const settings =
      state.snapshot?.settings ||
      {};


    if (
      $("settingOrdersOpen")
    ) {

      $("settingOrdersOpen").checked =
        settings.ordersOpen !==
        false;
    }


    if (
      $("settingAnnouncement")
    ) {

      $("settingAnnouncement").checked =
        settings.announcementEnabled ===
        true;
    }


    if (
      $("settingMaintenance")
    ) {

      $("settingMaintenance").checked =
        settings.maintenanceMode ===
        true;
    }


    if (
      $("announcementText")
    ) {

      $("announcementText").value =
        settings.announcementText ||
        "";
    }
  }


  async function saveSettings() {

    const message =
      $("storeSettingsMessage");


    message?.classList.remove(
      "error",
      "success"
    );


    setText(
      message,
      "Saving…"
    );


    try {

      await api(
        "/api/admin/control/settings",
        {
          method:
            "PUT",

          body: {
            ordersOpen:
              $("settingOrdersOpen")
                ?.checked ===
              true,

            announcementEnabled:
              $("settingAnnouncement")
                ?.checked ===
              true,

            maintenanceMode:
              $("settingMaintenance")
                ?.checked ===
              true,

            announcementText:
              safeString(
                $("announcementText")
                  ?.value
              )
                .trim()
                .slice(
                  0,
                  1000
                )
          }
        }
      );


      message?.classList.add(
        "success"
      );


      setText(
        message,
        "Store settings saved."
      );


      toast(
        "GRIM store settings updated."
      );


      await loadDashboard();

    } catch (error) {

      message?.classList.add(
        "error"
      );


      setText(
        message,
        error?.message ||
        "Unable to save settings."
      );
    }
  }


  /* =========================================================
     RENDER EVERYTHING
  ========================================================= */

  function renderEverything() {

    renderStats();

    renderActivity();

    renderCustomers();

    renderOrders();

    renderPayments();

    renderSupport();

    renderNotifications();

    renderProducts();

    renderSettings();
  }


  /* =========================================================
     AUTO REFRESH
  ========================================================= */

  function stopAutoRefresh() {

    if (
      state.refreshTimer
    ) {

      clearInterval(
        state.refreshTimer
      );

      state.refreshTimer =
        null;
    }
  }


  function startAutoRefresh() {

    stopAutoRefresh();


    state.refreshTimer =
  setInterval(() => {
    const storeControlOpen =
      document
        .getElementById("panel-store")
        ?.classList.contains("active");

    if (
      document.visibilityState ===
        "visible" &&
      !storeControlOpen
    ) {
      loadDashboard();
    }
  }, 15000);
  }


  /* =========================================================
     EVENTS
  ========================================================= */

  $("adminLoginForm")
    ?.addEventListener(
      "submit",
      async event => {

        event.preventDefault();


        const email =
  safeString(
    $("adminEmail")?.value
  )
    .trim()
    .toLowerCase();

const password =
  safeString(
    $("adminPassword")?.value
  );

if (!email || !password) {
  setText(
    $("adminLoginMessage"),
    "Enter the admin email and password."
  );

  return;
}

await loginAdmin(
  email,
  password
);
      }
    );


  $("adminLogout")
    ?.addEventListener(
      "click",
      logoutAdmin
    );


  $("refreshDashboard")
    ?.addEventListener(
      "click",
      () => {
        loadDashboard(true);
      }
    );


  $("customerSearch")
    ?.addEventListener(
      "input",
      renderCustomers
    );


  $("orderFilter")
    ?.addEventListener(
      "change",
      renderOrders
    );


  $("saveStoreSettings")
    ?.addEventListener(
      "click",
      saveSettings
    );


  $("markNotificationsRead")
    ?.addEventListener(
      "click",
      markNotificationsRead
    );


  $("clearActivityView")
    ?.addEventListener(
      "click",
      () => {

        const feed =
          $("activityFeed");


        if (feed) {

          feed.innerHTML =
            `
              <p class="empty-state">
                Activity hidden from this view.
                Refresh to reload.
              </p>
            `;
        }
      }
    );


  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          openPanel(
            button.dataset.panel ||
            "overview"
          );
        }
      );
    });


  document
    .addEventListener(
      "visibilitychange",
      () => {

        if (
          document.visibilityState ===
            "visible" &&
          state.authenticated
        ) {

          loadDashboard();
        }
      }
    );


  window
    .addEventListener(
      "online",
      () => {

        if (
          state.authenticated
        ) {
          loadDashboard();
        }
      }
    );


  window
    .addEventListener(
      "offline",
      () => {

        setConnection(
          "offline",
          "Offline"
        );
      }
    );


  /* =========================================================
     STARTUP
  ========================================================= */

  async function start() {

    const requestedPanel =
      safeString(
        window.location.hash
      )
        .replace(
          "#",
          ""
        );


    if (
      panelTitles[
        requestedPanel
      ]
    ) {

      openPanel(
        requestedPanel
      );

    } else {

      openPanel(
        "overview"
      );
    }


    const loggedIn =
      await checkAdminStatus();


    if (loggedIn) {

      await loadDashboard();
    }
  }


  start();



  /* =========================================================
     CUSTOMER PUSH SENDER
  ========================================================= */

  async function sendCustomerPush() {
    const button = $("sendPushNotification");
    const status = $("pushSendMessage");
    const title = safeString($("pushTitle")?.value || "GRIM").trim();
    const body = safeString($("pushMessage")?.value).trim();
    const category = safeString($("pushCategory")?.value || "general").trim();
    const url = safeString($("pushUrl")?.value || "/").trim() || "/";
    const adminKey = safeString($("pushAdminKey")?.value).trim();

    status?.classList.remove("error", "success");

    if (!body) {
      status?.classList.add("error");
      setText(status, "Write a notification message first.");
      return;
    }

    if (!adminKey) {
      status?.classList.add("error");
      setText(status, "Enter the GRIM push admin key.");
      return;
    }

    const original = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "SENDING…";
    }
    setText(status, "Sending GRIM notification…");

    try {
      const result = await api("/api/push/admin/send", {
        method: "POST",
        headers: { "x-grim-admin-key": adminKey },
        body: { title, body, category, url }
      });

      // Never retain the secret after the request.
      if ($("pushAdminKey")) $("pushAdminKey").value = "";

      const sent = Number(result?.sent || 0);
      const targeted = Number(result?.targeted || 0);
      const failed = Number(result?.failed || 0);
      const removed = Number(result?.expiredRemoved || 0);

      status?.classList.add(sent > 0 ? "success" : "error");
      setText(
        status,
        sent > 0
          ? `Sent to ${sent} device${sent === 1 ? "" : "s"}. Targeted ${targeted}${failed ? ` · Failed ${failed}` : ""}${removed ? ` · Expired removed ${removed}` : ""}.`
          : `No notification was delivered. Targeted ${targeted}${failed ? ` · Failed ${failed}` : ""}${removed ? ` · Expired removed ${removed}` : ""}.`
      );

      toast(sent > 0 ? `GRIM push sent to ${sent} device${sent === 1 ? "" : "s"}.` : "No GRIM push was delivered.");
    } catch (error) {
      status?.classList.add("error");
      setText(status, error?.message || "Unable to send GRIM notification.");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = original || "SEND NOTIFICATION";
      }
    }
  }

  function setupPushSender() {
    const message = $("pushMessage");
    const counter = $("pushMessageCount");
    const updateCount = () => setText(counter, safeString(message?.value).length);
    message?.addEventListener("input", updateCount);
    updateCount();
    $("sendPushNotification")?.addEventListener("click", sendCustomerPush);
  }


  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupPushSender, { once: true });
  } else {
    setupPushSender();
  }

})();

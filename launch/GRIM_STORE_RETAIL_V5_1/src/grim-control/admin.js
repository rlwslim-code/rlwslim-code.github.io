/*
 * ============================================================
 * GRIM CONTROL CENTER — ADMIN BACKEND
 * ============================================================
 *
 * Isolated administration layer.
 *
 * Handles:
 * - Admin authentication
 * - Dashboard snapshot
 * - Customers
 * - Sessions / online status
 * - Orders
 * - Payments
 * - Support
 * - Activity
 * - Notifications
 * - Products
 */

import crypto from "crypto";

import {
  grimSupabase,
  grimSupabaseReady
} from "./supabase.js";

import {
  isGrimSessionOnline
} from "./sessions.js";


/* ============================================================
   HELPERS
============================================================ */

function noCache(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );
}


function safeString(value = "") {
  return String(
    value ?? ""
  );
}


function secureCompare(
  supplied,
  expected
) {
  const a =
    Buffer.from(
      safeString(supplied)
    );

  const b =
    Buffer.from(
      safeString(expected)
    );

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    a,
    b
  );
}


function adminConfigured() {
  return Boolean(
    process.env.ADMIN_EMAIL &&
    process.env.ADMIN_PASSWORD
  );
}


function adminOnly(
  req,
  res,
  next
) {
  if (
    req?.session?.admin === true
  ) {
    return next();
  }

  return res
    .status(401)
    .json({
      ok: false,
      error:
        "Admin authentication required."
    });
}


function todayStartISO() {
  const date =
    new Date();

  date.setUTCHours(
    0,
    0,
    0,
    0
  );

  return date.toISOString();
}


function normalizeStatus(
  value
) {
  return safeString(
    value || ""
  )
    .trim()
    .toLowerCase();
}


/* ============================================================
   OPTIONAL TABLE READER
============================================================ */

async function firstAvailableTable(
  names,
  buildQuery
) {
  if (!grimSupabase) {
    return [];
  }

  for (const name of names) {

    try {

      const query =
        buildQuery(
          grimSupabase.from(name)
        );

      const {
        data,
        error
      } = await query;

      if (!error) {
        return Array.isArray(data)
          ? data
          : [];
      }

      const message =
        safeString(
          error?.message
        ).toLowerCase();

      /*
       * If that table simply doesn't exist,
       * try the next candidate.
       */
      if (
        message.includes(
          "does not exist"
        ) ||
        message.includes(
          "could not find"
        ) ||
        message.includes(
          "schema cache"
        )
      ) {
        continue;
      }

      console.warn(
        `[GRIM ADMIN] ${name}:`,
        error.message
      );

    } catch (error) {

      console.warn(
        `[GRIM ADMIN] ${name}:`,
        error?.message ||
        error
      );
    }
  }

  return [];
}


/* ============================================================
   CUSTOMER DATA
============================================================ */

async function loadCustomers() {
  const {
    data,
    error
  } = await grimSupabase
    .from(
      "customer_profiles"
    )
    .select("*")
    .limit(500);

  if (error) {
    throw error;
  }

  return data || [];
}


async function loadSessions() {

  const {
    data,
    error
  } = await grimSupabase
    .from(
      "customer_sessions"
    )
    .select("*")
    .order(
      "last_seen_at",
      {
        ascending: false
      }
    )
    .limit(1000);

  if (error) {
    throw error;
  }

  return data || [];
}


function mergeCustomerSessions(
  customers,
  sessions
) {
  const latest =
    new Map();

  for (
    const session
    of sessions
  ) {

    const customerId =
      safeString(
        session.customer_id
      );

    if (!customerId) {
      continue;
    }

    if (
      !latest.has(
        customerId
      )
    ) {
      latest.set(
        customerId,
        session
      );
    }
  }


  return customers.map(
    customer => {

      const session =
        latest.get(
          safeString(
            customer.id
          )
        ) || null;


      const online =
        Boolean(
          session &&
          !session.logout_at &&
          isGrimSessionOnline(
            session.last_seen_at,
            3
          )
        );


      return {
        ...customer,

        online,

        is_online:
          online,

        last_login_at:
          session?.login_at ||
          null,

        last_seen_at:
          session?.last_seen_at ||
          null,

        logout_at:
          session?.logout_at ||
          null,

        current_path:
          session?.current_path ||
          null,

        country:
          session?.country ||
          null,

        device_type:
          session?.device_type ||
          null,

        browser:
          session?.browser ||
          null
      };
    }
  );
}


/* ============================================================
   ORDERS
============================================================ */

async function loadOrders() {

  const {
    data,
    error
  } = await grimSupabase
    .from(
      "orders"
    )
    .select("*")
    .order(
      "created_at",
      {
        ascending: false
      }
    )
    .limit(300);

  if (error) {

    console.warn(
      "[GRIM ADMIN] orders:",
      error.message
    );

    return [];
  }

  return data || [];
}


/* ============================================================
   SUPPORT
============================================================ */

async function loadSupport() {

  const {
    data,
    error
  } = await grimSupabase
    .from(
      "support_tickets"
    )
    .select("*")
    .order(
      "created_at",
      {
        ascending: false
      }
    )
    .limit(200);

  if (error) {

    console.warn(
      "[GRIM ADMIN] support:",
      error.message
    );

    return [];
  }

  return data || [];
}


/* ============================================================
   PRODUCTS
============================================================ */

async function loadProducts() {

  const {
    data,
    error
  } = await grimSupabase
    .from(
      "products"
    )
    .select(
      "id,name,type,price,color,image,active,sort_order"
    )
    .order(
      "sort_order",
      {
        ascending: true
      }
    );

  if (error) {

    console.warn(
      "[GRIM ADMIN] products:",
      error.message
    );

    return [];
  }

  return data || [];
}


/* ============================================================
   ACTIVITY
============================================================ */

async function loadActivity() {

  return firstAvailableTable(
    [
      "activity_log",
      "activity_logs",
      "grim_activity",
      "grim_activity_log",
      "activity_events"
    ],

    table =>
      table
        .select("*")
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(250)
  );
}


function paymentRowsFromActivity(
  activity
) {

  return activity
    .filter(row => {

      const category =
        normalizeStatus(
          row.category
        );

      const type =
        normalizeStatus(
          row.event_type
        );

      return (
        category ===
          "payment" ||
        type.startsWith(
          "payment_"
        )
      );
    })
    .map(row => {

      const metadata =
        row.metadata &&
        typeof row.metadata ===
          "object"
          ? row.metadata
          : {};

      return {
        ...row,

        reference:
          metadata.reference ||
          row.reference ||
          null,

        status:
          metadata.status ||
          row.status ||
          row.event_type,

        amount:
          metadata.amount ??
          row.amount ??
          null,

        currency:
          metadata.currency ||
          row.currency ||
          "NGN"
      };
    });
}


/* ============================================================
   NOTIFICATIONS
============================================================ */

async function loadNotifications(
  activity
) {

  const notifications =
    await firstAvailableTable(
      [
        "admin_notifications",
        "grim_notifications",
        "notifications"
      ],

      table =>
        table
          .select("*")
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(100)
    );


  if (
    notifications.length
  ) {
    return notifications;
  }


  /*
   * Safe fallback:
   * if a dedicated notification table isn't available,
   * show recent activity as notifications.
   */

  return activity
    .slice(0, 50)
    .map(row => ({
      id:
        row.id,

      title:
        row.title ||
        row.event_type ||
        "GRIM activity",

      message:
        row.message ||
        "",

      created_at:
        row.created_at,

      read:
        false,

      severity:
        row.severity ||
        "info"
    }));
}


/* ============================================================
   STATISTICS
============================================================ */

function calculateStats({
  customers,
  sessions,
  orders,
  payments
}) {

  const today =
    todayStartISO();


  const onlineNow =
    sessions.filter(
      session =>
        !session.logout_at &&
        isGrimSessionOnline(
          session.last_seen_at,
          3
        )
    ).length;


  const signupsToday =
    customers.filter(
      customer =>
        customer.created_at &&
        customer.created_at >=
          today
    ).length;


  const ordersTodayRows =
    orders.filter(
      order =>
        order.created_at &&
        order.created_at >=
          today
    );


  const paidStatuses =
    new Set([
      "paid",
      "success",
      "successful",
      "completed"
    ]);


  const revenueToday =
    ordersTodayRows
      .filter(order => {

        const status =
          normalizeStatus(
            order.payment_status ||
            order.status
          );

        return paidStatuses.has(
          status
        );
      })
      .reduce(
        (
          total,
          order
        ) =>
          total +
          Number(
            order.total ||
            order.amount ||
            0
          ),
        0
      );


  const completedStatuses =
    new Set([
      "delivered",
      "cancelled",
      "canceled",
      "refunded"
    ]);


  const pendingOrders =
    orders.filter(
      order =>
        !completedStatuses.has(
          normalizeStatus(
            order.delivery_status ||
            order.status
          )
        )
    ).length;


  return {
    onlineNow,

    totalCustomers:
      customers.length,

    signupsToday,

    ordersToday:
      ordersTodayRows.length,

    revenueToday,

    pendingOrders,

    currency:
      "NGN",

    trackedPayments:
      payments.length
  };
}


/* ============================================================
   SNAPSHOT
============================================================ */

async function buildSnapshot() {

  if (
    !grimSupabaseReady()
  ) {
    throw new Error(
      "Supabase is not configured."
    );
  }


  const [
    customersRaw,
    sessions,
    orders,
    support,
    products,
    activity
  ] =
    await Promise.all([
      loadCustomers(),
      loadSessions(),
      loadOrders(),
      loadSupport(),
      loadProducts(),
      loadActivity()
    ]);


  const customers =
    mergeCustomerSessions(
      customersRaw,
      sessions
    );


  const payments =
    paymentRowsFromActivity(
      activity
    );


  const notifications =
    await loadNotifications(
      activity
    );


  const stats =
    calculateStats({
      customers:
        customersRaw,

      sessions,
      orders,
      payments
    });


  return {
    ok: true,

    generatedAt:
      new Date()
        .toISOString(),

    stats,

    customers,

    orders,

    activity,

    payments,

    support,

    notifications,

    products,

    /*
     * Safe defaults.
     * We will connect editable store settings
     * after the dashboard itself is stable.
     */

    settings: {
      ordersOpen:
        true,

      announcementEnabled:
        false,

      maintenanceMode:
        false,

      announcementText:
        ""
    }
  };
}


/* ============================================================
   INSTALL ADMIN ROUTES
============================================================ */

export function installGrimAdmin(
  app
) {

  if (!app) {
    throw new Error(
      "GRIM Admin requires the Express app."
    );
  }


  if (
    app.locals
      ?.grimAdminInstalled
  ) {
    return;
  }


  app.locals.grimAdminInstalled =
    true;


  /* --------------------------------------------------------
     STATUS
  --------------------------------------------------------- */

  app.get(
    "/api/admin/status",
    (
      req,
      res
    ) => {

      noCache(res);

      res.json({
        ok: true,

        loggedIn:
          req?.session?.admin ===
          true,

        authenticated:
          req?.session?.admin ===
          true,

        admin:
          req?.session?.admin ===
          true
      });
    }
  );


  /* --------------------------------------------------------
     LOGIN
  --------------------------------------------------------- */

  app.post(
    "/api/admin/login",
    (
      req,
      res
    ) => {

      noCache(res);


      if (
        !adminConfigured()
      ) {

        return res
          .status(503)
          .json({
            ok: false,
            error:
              "ADMIN_PASSWORD is not configured."
          });
      }


      const email =
  safeString(
    req.body?.email
  )
    .trim()
    .toLowerCase();

const password =
  safeString(
    req.body?.password
  );

const expectedEmail =
  safeString(
    process.env.ADMIN_EMAIL
  )
    .trim()
    .toLowerCase();

const emailOk =
  secureCompare(
    email,
    expectedEmail
  );

const passwordOk =
  secureCompare(
    password,
    process.env.ADMIN_PASSWORD
  );

if (!emailOk || !passwordOk) {
  return res
    .status(401)
    .json({
      ok: false,
      error:
        "Incorrect admin email or password."
    });
}


      req.session.admin =
        true;


      if (
        typeof req.session
          ?.save ===
        "function"
      ) {

        return req.session.save(
          error => {

            if (error) {

              console.error(
                "[GRIM ADMIN] session save:",
                error
              );

              return res
                .status(500)
                .json({
                  ok: false,
                  error:
                    "Unable to start admin session."
                });
            }


            return res.json({
              ok: true
            });
          }
        );
      }


      return res.json({
        ok: true
      });
    }
  );


  /* --------------------------------------------------------
     LOGOUT
  --------------------------------------------------------- */

  app.post(
    "/api/admin/logout",
    (
      req,
      res
    ) => {

      noCache(res);


      if (
        req?.session
      ) {
        req.session.admin =
          false;
      }


      if (
        typeof req.session
          ?.save ===
        "function"
      ) {

        return req.session.save(
          () => {

            res.json({
              ok: true
            });
          }
        );
      }


      return res.json({
        ok: true
      });
    }
  );


  /* --------------------------------------------------------
     CONTROL CENTER SNAPSHOT
  --------------------------------------------------------- */

  app.get(
    "/api/admin/control/snapshot",
    adminOnly,
    async (
      _req,
      res
    ) => {

      noCache(res);

      try {

        const snapshot =
          await buildSnapshot();


        return res.json(
          snapshot
        );

      } catch (error) {

        console.error(
          "[GRIM ADMIN] snapshot:",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,

            error:
              error?.message ||
              "Unable to load GRIM Control Center."
          });
      }
    }
  );


  /*
   * We'll make these persistent once the dashboard
   * read side has been tested successfully.
   */

  app.put(
    "/api/admin/control/settings",
    adminOnly,
    (
      _req,
      res
    ) => {

      return res
        .status(503)
        .json({
          ok: false,

          error:
            "Store settings editing will be enabled in the next control-center stage."
        });
    }
  );


  app.post(
    "/api/admin/control/notifications/read",
    adminOnly,
    (
      _req,
      res
    ) => {

      return res.json({
        ok: true
      });
    }
  );


  console.log(
    "[GRIM ADMIN] Control Center routes installed."
  );
}

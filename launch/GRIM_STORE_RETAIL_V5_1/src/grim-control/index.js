import {
  ensureGrimCustomer,
  startGrimSession,
  touchGrimSession,
  endGrimSession
} from "./sessions.js";

import {
  logGrimActivity,
  trackOrderActivity,
  trackSupportMessage,
  trackPaymentActivity,
  trackSystemError
} from "./activity.js";

import {
  installGrimAdmin
} from "./admin.js";
import {
  installGrimProductAdmin
} from "./grim-addons/product-admin.js";

import {
  installGrimSiteControls
} from "./grim-addons/site-controls.js";
import {
  installGrimAdminSession
} from "./grim-addons/admin-session.js";
function requestPath(req) {
  return String(
    req?.path ||
    req?.originalUrl ||
    ""
  ).split("?")[0];
}

function successfulResponse(res, body) {
  if (res.statusCode >= 400) {
    return false;
  }

  if (
    body &&
    typeof body === "object" &&
    body.ok === false
  ) {
    return false;
  }

  return true;
}

async function trackAccountRequest(
  req,
  path,
  responseBody
) {
  const user =
    req?.session?.user ||
    (
      responseBody?.email
        ? responseBody
        : null
    );

  if (!user?.email) return;

  const authMethod =
    path === "/api/auth/google"
      ? "google"
      : "password";

  const customer =
    await ensureGrimCustomer({
      name: user.name || "",
      email: user.email,
      phone: user.phone || null,
      signupMethod: authMethod
    });

  if (!customer) return;

  if (!req?.session?.grimSessionId) {
    await startGrimSession(
      req,
      user,
      authMethod
    );
  }

  const isSignup =
    path === "/api/register" ||
    (
      path === "/api/auth/google" &&
      responseBody?.newUser === true
    );

  await logGrimActivity({
    eventType:
      isSignup
        ? "signup"
        : authMethod === "google"
          ? "google_login"
          : "login",
    category: "account",
    customerId: customer.id,
    sessionId:
      req?.session?.grimSessionId ||
      null,
    title:
      isSignup
        ? "New GRIM signup"
        : authMethod === "google"
          ? "Google login"
          : "Customer login",
    message:
      isSignup
        ? `${user.name || user.email} created a GRIM account.`
        : `${user.name || user.email} signed in to GRIM.`,
    severity:
      isSignup
        ? "success"
        : "info",
    path,
    /*
     * The GRIM database foundation can also create signup notifications
     * when a profile is inserted. Keep signup notify=false to avoid duplicates.
     */
    notify: isSignup ? false : true,
    actionUrl: "/admin.html#users"
  });
}

async function observeOrder(
  req,
  responseBody
) {
  if (!responseBody?.orderId) return;

  const body = req.body || {};

  await trackOrderActivity(
    req,
    {
      id: responseBody.orderId,
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      items:
        Array.isArray(body.items)
          ? body.items
          : [],
      total: responseBody.total
    }
  );
}

async function observeSupport(
  req,
  responseBody
) {
  if (!responseBody?.ticketId) return;

  const body = req.body || {};

  await trackSupportMessage(
    req,
    {
      ticketId:
        responseBody.ticketId,
      topic:
        body.topic,
      name:
        body.name,
      email:
        body.email
    }
  );
}

async function observePayment(
  req,
  res,
  responseBody
) {
  if (res.statusCode >= 500) return;

  const reference =
    responseBody?.reference ||
    req?.body?.reference ||
    null;

  if (!reference) return;

  let status =
    responseBody?.status ||
    responseBody?.data?.status ||
    null;

  if (!status) {
    status =
      responseBody?.verified === true
        ? "success"
        : "failed";
  }

  await trackPaymentActivity(
    req,
    {
      reference,
      status,
      amount:
        responseBody?.amount ??
        responseBody?.data?.amount ??
        null,
      currency:
        responseBody?.currency ||
        responseBody?.data?.currency ||
        null
    }
  );
}

async function observeFinishedRequest(
  req,
  res,
  responseBody
) {
  try {
    const path = requestPath(req);

    if (
      successfulResponse(
        res,
        responseBody
      ) &&
      (
        path === "/api/register" ||
        path === "/api/login" ||
        path === "/api/auth/google"
      )
    ) {
      await trackAccountRequest(
        req,
        path,
        responseBody
      );
    }

    if (
      path === "/api/orders" &&
      successfulResponse(
        res,
        responseBody
      )
    ) {
      await observeOrder(
        req,
        responseBody
      );
    }

    if (
      path === "/api/support" &&
      successfulResponse(
        res,
        responseBody
      )
    ) {
      await observeSupport(
        req,
        responseBody
      );
    }

    if (
      path === "/api/payments/verify"
    ) {
      await observePayment(
        req,
        res,
        responseBody
      );
    }

    if (
      res.statusCode >= 500 &&
      !path.startsWith("/api/admin/")
    ) {
      await trackSystemError(
        req,
        {
          title:
            "GRIM server error",
          message:
            `${req.method} ${path} returned ${res.statusCode}.`,
          metadata: {
            status_code:
              res.statusCode,
            method:
              req.method,
            path
          }
        }
      );
    }
  } catch (error) {
    console.error(
      "[GRIM CONTROL] observer:",
      error?.message || error
    );
  }
}

export function installGrimControl(app) {
  if (!app) {
    throw new Error(
      "GRIM Control requires the Express app."
    );
  }

  if (
    app.locals?.grimControlInstalled
  ) {
    return;
  }

  app.locals.grimControlInstalled =
    true;
 
  installGrimAdminSession(app);
  installGrimAdmin(app);
 installGrimProductAdmin(app);
installGrimSiteControls(app);
  app.use(async (req, res, next) => {
    const path = requestPath(req);

    if (
      req?.session?.user &&
      !req?.session?.grimSessionId &&
      path !== "/api/logout"
    ) {
      await startGrimSession(
        req,
        req.session.user,
        "password"
      );
    }

    let capturedBody = null;

    const originalJson =
      res.json.bind(res);

    res.json = function (body) {
      capturedBody = body;
      return originalJson(body);
    };

    res.once("finish", () => {
      observeFinishedRequest(
        req,
        res,
        capturedBody
      ).catch(error => {
        console.error(
          "[GRIM CONTROL] finish observer:",
          error?.message || error
        );
      });
    });

    next();
  });

  app.post(
    "/api/session/heartbeat",
    async (req, res) => {
      if (!req?.session?.user) {
        return res.status(401).json({
          ok: false,
          authenticated: false
        });
      }

      if (!req.session.grimSessionId) {
        await startGrimSession(
          req,
          req.session.user,
          "password"
        );
      }

      await touchGrimSession(
        req,
        req.body?.path ||
        req.headers?.referer ||
        "/"
      );

      return res.json({
        ok: true
      });
    }
  );

  app.post(
    "/api/logout",
    async (req, res) => {
      await endGrimSession(
        req,
        "logout"
      );

      if (!req.session) {
        return res.json({
          ok: true
        });
      }

      req.session.user = null;

      if (
        typeof req.session.save !==
        "function"
      ) {
        return res.json({
          ok: true
        });
      }

      req.session.save(error => {
        if (error) {
          console.error(
            "[GRIM CONTROL] logout save:",
            error
          );
        }

        res.json({
          ok: true
        });
      });
    }
  );

  console.log(
    "[GRIM CONTROL] Control center installed."
  );
}

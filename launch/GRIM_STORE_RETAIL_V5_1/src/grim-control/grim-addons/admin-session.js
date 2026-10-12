/*
 * ============================================================
 * GRIM ADMIN SESSION BRIDGE
 * Isolated backend add-on for serverless-safe admin reloads
 * ============================================================
 *
 * Goal:
 * - keep admin authenticated across reloads in the SAME tab/session
 * - require login again after sessionStorage disappears (tab/session close)
 * - do not change customer auth, checkout, Paystack, Product Manager,
 *   or Site Controls behavior
 *
 * Install BEFORE installGrimAdmin(app), installGrimProductAdmin(app),
 * and installGrimSiteControls(app).
 */

import crypto from "crypto";

const TOKEN_VERSION = 1;
const TOKEN_SCOPE = "grim-admin";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours maximum

function safeString(value = "") {
  return String(value ?? "");
}

function sessionSecret() {
  /*
   * ADMIN_SESSION_SECRET is preferred for secret separation.
   * SESSION_SECRET is the normal fallback already expected by GRIM.
   * PAYSTACK_SECRET_KEY is retained only as a compatibility fallback so
   * the add-on can work during rollout without exposing any secret.
   */
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.PAYSTACK_SECRET_KEY ||
    ""
  );
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(payloadText, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadText)
    .digest("base64url");
}

function secureEqual(a, b) {
  const left = Buffer.from(safeString(a));
  const right = Buffer.from(safeString(b));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function mintToken() {
  const secret = sessionSecret();

  if (!secret) {
    return null;
  }

  const now = Date.now();
  const payload = {
    v: TOKEN_VERSION,
    scope: TOKEN_SCOPE,
    iat: now,
    exp: now + TOKEN_TTL_MS,
    nonce: crypto.randomBytes(12).toString("hex")
  };

  const payloadPart = base64url(JSON.stringify(payload));
  const signaturePart = signPayload(payloadPart, secret);

  return `${payloadPart}.${signaturePart}`;
}

function verifyToken(token) {
  const secret = sessionSecret();

  if (!secret || !token) {
    return false;
  }

  const parts = safeString(token).split(".");

  if (parts.length !== 2) {
    return false;
  }

  const [payloadPart, signaturePart] = parts;
  const expectedSignature = signPayload(payloadPart, secret);

  if (!secureEqual(signaturePart, expectedSignature)) {
    return false;
  }

  let payload;

  try {
    payload = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8")
    );
  } catch (_) {
    return false;
  }

  if (
    payload?.v !== TOKEN_VERSION ||
    payload?.scope !== TOKEN_SCOPE ||
    !Number.isFinite(Number(payload?.exp)) ||
    Number(payload.exp) <= Date.now()
  ) {
    return false;
  }

  return true;
}

function bearerToken(req) {
  const authorization = safeString(req?.headers?.authorization).trim();

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authorization.slice(7).trim();
}

function noCache(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );
}

export function installGrimAdminSession(app) {
  if (!app) {
    throw new Error("GRIM Admin Session requires the Express app.");
  }

  if (app.locals?.grimAdminSessionInstalled) {
    return;
  }

  app.locals.grimAdminSessionInstalled = true;

  /*
   * Attach a fresh signed token to the EXISTING successful login response.
   * This avoids editing the working login handler in admin.js.
   */
  app.use("/api/admin/login", (req, res, next) => {
    if (req.method !== "POST") {
      return next();
    }

    const originalJson = res.json.bind(res);

    res.json = function grimAdminLoginJson(body) {
      const successful =
        res.statusCode < 400 &&
        body &&
        typeof body === "object" &&
        body.ok !== false;

      if (!successful) {
        return originalJson(body);
      }

      const token = mintToken();

      if (!token) {
        console.warn(
          "[GRIM ADMIN SESSION] No signing secret is configured. " +
          "Set ADMIN_SESSION_SECRET or SESSION_SECRET in Vercel."
        );

        return originalJson(body);
      }

      return originalJson({
        ...body,
        adminSessionToken: token,
        adminSessionExpiresIn: TOKEN_TTL_MS
      });
    };

    return next();
  });

  /*
   * For every /api/admin request, accept the signed token sent by the
   * admin-tab frontend and temporarily restore req.session.admin.
   * Existing adminOnly checks continue to work unchanged.
   */
  app.use("/api/admin", (req, res, next) => {
    noCache(res);

    if (req?.session?.admin === true) {
      return next();
    }

    const token = bearerToken(req);

    if (!verifyToken(token)) {
      return next();
    }

    if (req?.session) {
      req.session.admin = true;
    }

    req.grimAdminSessionToken = true;

    return next();
  });

  console.log("[GRIM ADMIN SESSION] session bridge installed.");
}

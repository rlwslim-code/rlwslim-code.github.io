import crypto from "crypto";
import { grimSupabase } from "./supabase.js";

function cleanEmail(email = "") {
  return String(email)
    .trim()
    .toLowerCase()
    .slice(0, 320);
}

function hashValue(value = "") {
  if (!value) return null;

  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function getClientIp(req) {
  const forwarded =
    req?.headers?.["x-forwarded-for"];

  if (forwarded) {
    return String(forwarded)
      .split(",")[0]
      .trim();
  }

  return (
    req?.headers?.["x-real-ip"] ||
    req?.socket?.remoteAddress ||
    ""
  );
}

function getCountry(req) {
  const value =
    req?.headers?.["x-vercel-ip-country"] ||
    req?.headers?.["cf-ipcountry"] ||
    "";

  const country =
    String(value).toUpperCase();

  return /^[A-Z]{2}$/.test(country)
    ? country
    : null;
}

function detectDevice(userAgent = "") {
  const ua =
    String(userAgent).toLowerCase();

  if (/ipad|tablet/.test(ua)) {
    return "tablet";
  }

  if (/iphone|android|mobile/.test(ua)) {
    return "mobile";
  }

  return "desktop";
}

function detectBrowser(userAgent = "") {
  const ua = String(userAgent);

  if (/Edg\//i.test(ua)) return "Edge";
  if (/CriOS|Chrome/i.test(ua)) return "Chrome";
  if (/FxiOS|Firefox/i.test(ua)) return "Firefox";

  if (
    /Safari/i.test(ua) &&
    !/Chrome|CriOS|Android/i.test(ua)
  ) {
    return "Safari";
  }

  return "Other";
}

function logError(label, error) {
  console.error(
    `[GRIM CONTROL] ${label}:`,
    error?.message || error
  );
}

export async function ensureGrimCustomer({
  name = "",
  email = "",
  phone = null,
  signupMethod = "password"
} = {}) {
  if (!grimSupabase) return null;

  const normalizedEmail =
    cleanEmail(email);

  if (!normalizedEmail) {
    return null;
  }

  try {
    const {
      data: existing,
      error: findError
    } = await grimSupabase
      .from("customer_profiles")
      .select("*")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      const updates = {};

      if (
        name &&
        String(name).trim() &&
        !existing.name
      ) {
        updates.name =
          String(name)
            .trim()
            .slice(0, 160);
      }

      if (phone && !existing.phone) {
        updates.phone =
          String(phone)
            .trim()
            .slice(0, 80);
      }

      if (Object.keys(updates).length > 0) {
        const {
          data,
          error
        } = await grimSupabase
          .from("customer_profiles")
          .update(updates)
          .eq("id", existing.id)
          .select("*")
          .single();

        if (error) throw error;
        return data;
      }

      return existing;
    }

    const {
      data,
      error
    } = await grimSupabase
      .from("customer_profiles")
      .insert({
        name:
          String(name || "")
            .trim()
            .slice(0, 160),
        email: normalizedEmail,
        phone:
          phone
            ? String(phone)
                .trim()
                .slice(0, 80)
            : null,
        signup_method:
          String(
            signupMethod || "password"
          ).slice(0, 40)
      })
      .select("*")
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    logError(
      "ensure customer",
      error
    );
    return null;
  }
}

export async function startGrimSession(
  req,
  user,
  signupMethod = "password"
) {
  if (
    !grimSupabase ||
    !user?.email
  ) {
    return null;
  }

  try {
    const customer =
      await ensureGrimCustomer({
        name: user.name || "",
        email: user.email,
        phone: user.phone || null,
        signupMethod
      });

    if (!customer) return null;

    const userAgent =
      String(
        req?.headers?.["user-agent"] ||
        ""
      ).slice(0, 1000);

    const sessionKey =
      req?.sessionID ||
      crypto.randomUUID();

    const now =
      new Date().toISOString();

    const {
      data: sessionRow,
      error
    } = await grimSupabase
      .from("customer_sessions")
      .insert({
        customer_id:
          customer.id,
        session_key_hash:
          hashValue(sessionKey),
        login_at:
          now,
        last_seen_at:
          now,
        current_path:
          req?.originalUrl || "/",
        user_agent:
          userAgent,
        ip_hash:
          hashValue(
            getClientIp(req)
          ),
        country:
          getCountry(req),
        device_type:
          detectDevice(userAgent),
        browser:
          detectBrowser(userAgent)
      })
      .select("id")
      .single();

    if (error) throw error;

    if (req?.session) {
      req.session.grimCustomerId =
        customer.id;
      req.session.grimSessionId =
        sessionRow.id;
    }

    return {
      customerId:
        customer.id,
      sessionId:
        sessionRow.id
    };
  } catch (error) {
    logError(
      "start session",
      error
    );
    return null;
  }
}

export async function touchGrimSession(
  req,
  currentPath = null
) {
  if (!grimSupabase) return false;

  const sessionId =
    req?.session?.grimSessionId;

  if (!sessionId) return false;

  try {
    const update = {
      last_seen_at:
        new Date().toISOString()
    };

    if (currentPath) {
      update.current_path =
        String(currentPath)
          .slice(0, 500);
    }

    const { error } =
      await grimSupabase
        .from("customer_sessions")
        .update(update)
        .eq("id", sessionId);

    if (error) throw error;
    return true;
  } catch (error) {
    logError(
      "heartbeat",
      error
    );
    return false;
  }
}

export async function endGrimSession(
  req,
  reason = "logout"
) {
  if (!grimSupabase) return false;

  const sessionId =
    req?.session?.grimSessionId;

  if (!sessionId) return false;

  try {
    const now =
      new Date().toISOString();

    const { error } =
      await grimSupabase
        .from("customer_sessions")
        .update({
          last_seen_at:
            now,
          logout_at:
            now,
          ended_reason:
            String(
              reason || "logout"
            ).slice(0, 80)
        })
        .eq("id", sessionId);

    if (error) throw error;

    if (req?.session) {
      delete req.session.grimSessionId;
      delete req.session.grimCustomerId;
    }

    return true;
  } catch (error) {
    logError(
      "end session",
      error
    );
    return false;
  }
}

export function isGrimSessionOnline(
  lastSeenAt,
  minutes = 3
) {
  if (!lastSeenAt) return false;

  const lastSeen =
    new Date(lastSeenAt).getTime();

  if (Number.isNaN(lastSeen)) {
    return false;
  }

  return (
    Date.now() - lastSeen <=
    minutes * 60 * 1000
  );
}

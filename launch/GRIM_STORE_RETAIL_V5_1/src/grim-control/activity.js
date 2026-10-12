import { grimSupabase } from "./supabase.js";

function cleanEmail(email = "") {
  return String(email)
    .trim()
    .toLowerCase()
    .slice(0, 320);
}

function logError(label, error) {
  console.error(
    `[GRIM CONTROL] ${label}:`,
    error?.message || error
  );
}

export async function logGrimActivity({
  eventType,
  category = "website",
  customerId = null,
  sessionId = null,
  orderId = null,
  title = null,
  message = null,
  severity = "info",
  path = null,
  metadata = {},
  notify = false,
  actionUrl = null
} = {}) {
  if (!grimSupabase || !eventType) {
    return null;
  }

  try {
    const { data, error } = await grimSupabase.rpc(
      "grim_log_activity",
      {
        p_event_type: String(eventType),
        p_category: String(category),
        p_customer_id: customerId,
        p_session_id: sessionId,
        p_order_id:
          orderId === null || orderId === undefined
            ? null
            : String(orderId),
        p_title: title,
        p_message: message,
        p_severity: severity,
        p_path: path,
        p_metadata: metadata || {},
        p_notify: Boolean(notify),
        p_action_url: actionUrl
      }
    );

    if (error) throw error;
    return data;
  } catch (error) {
    logError(`activity ${eventType}`, error);
    return null;
  }
}

export async function trackOrderActivity(req, order) {
  if (!order) return null;

  const items = Array.isArray(order.items)
    ? order.items
    : [];

  const itemCount = items.reduce(
    (total, item) =>
      total + Number(item?.qty || 1),
    0
  );

  return logGrimActivity({
    eventType: "new_order",
    category: "order",
    customerId:
      req?.session?.grimCustomerId ||
      null,
    sessionId:
      req?.session?.grimSessionId ||
      null,
    orderId: order.id || null,
    title: "New GRIM order",
    message:
      `${order.name || order.email || "Customer"} placed order #${order.id}.`,
    severity: "success",
    path:
      req?.originalUrl ||
      "/api/orders",
    metadata: {
      order_id: order.id || null,
      email: cleanEmail(order.email),
      total: order.total ?? null,
      item_count: itemCount
    },
    notify: true,
    actionUrl: "/admin.html#orders"
  });
}

export async function trackSupportMessage(
  req,
  {
    ticketId,
    topic,
    name,
    email
  } = {}
) {
  return logGrimActivity({
    eventType: "support_message",
    category: "support",
    customerId:
      req?.session?.grimCustomerId ||
      null,
    sessionId:
      req?.session?.grimSessionId ||
      null,
    title:
      "New customer-care message",
    message:
      `${name || email || "Customer"} sent a ${topic || "support"} message.`,
    severity: "info",
    path:
      req?.originalUrl ||
      "/api/support",
    metadata: {
      ticket_id: ticketId || null,
      email: cleanEmail(email),
      topic: topic || null
    },
    notify: true,
    actionUrl: "/admin.html#activity"
  });
}

export async function trackPaymentActivity(
  req,
  {
    reference,
    status,
    amount,
    currency
  } = {}
) {
  const normalizedStatus =
    String(status || "failed")
      .trim()
      .toLowerCase();

  const successful =
    [
      "success",
      "successful",
      "paid",
      "completed"
    ].includes(normalizedStatus);

  return logGrimActivity({
    eventType: successful
      ? "payment_success"
      : "payment_failed",
    category: "payment",
    customerId:
      req?.session?.grimCustomerId ||
      null,
    sessionId:
      req?.session?.grimSessionId ||
      null,
    title: successful
      ? "Payment received"
      : "Payment problem",
    message: successful
      ? "A GRIM payment was verified successfully."
      : `A GRIM payment ended with status: ${normalizedStatus}.`,
    severity: successful
      ? "success"
      : "error",
    path:
      req?.originalUrl ||
      "/api/payments/verify",
    metadata: {
      reference: reference || null,
      status: normalizedStatus,
      amount: amount ?? null,
      currency: currency || null
    },
    notify: true,
    actionUrl: "/admin.html#orders"
  });
}

export async function trackSystemError(
  req,
  {
    title = "GRIM system error",
    message = "An application error occurred.",
    metadata = {}
  } = {}
) {
  return logGrimActivity({
    eventType: "system_error",
    category: "system",
    customerId:
      req?.session?.grimCustomerId ||
      null,
    sessionId:
      req?.session?.grimSessionId ||
      null,
    title,
    message,
    severity: "error",
    path:
      req?.originalUrl || null,
    metadata,
    notify: true,
    actionUrl: "/admin.html#activity"
  });
}

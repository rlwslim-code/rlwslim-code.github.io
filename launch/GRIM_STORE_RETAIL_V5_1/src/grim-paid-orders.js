import { grimSupabase } from "./grim-control/supabase.js";

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function fullAddress(order) {
  const delivery = order?.delivery || {};
  return [
    clean(delivery.address, 250),
    clean(delivery.apartment, 100),
    clean(delivery.city, 100),
    clean(delivery.state, 100),
    clean(delivery.postal, 30),
    clean(delivery.country, 2)
  ]
    .filter(Boolean)
    .join(", ");
}

function customerName(order) {
  const customer = order?.customer || {};
  return [
    clean(customer.firstName, 80),
    clean(customer.lastName, 80)
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function findExisting(reference) {
  const { data, error } = await grimSupabase
    .from("orders")
    .select("id,payment_reference,status,payment_status")
    .eq("payment_reference", reference)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

export async function finalizePaidOrder({ order, reference } = {}) {
  if (!grimSupabase) {
    throw new Error("Supabase is not configured for paid-order storage.");
  }

  const safeReference = clean(reference, 100);

  if (!safeReference || !order) {
    throw new Error("Paid-order details are incomplete.");
  }

  const existing = await findExisting(safeReference);

  if (existing) {
    if (existing.payment_status !== "paid") throw new Error("Reference exists but payment is not marked paid. Manual reconciliation required.");
    return {
      ...existing,
      duplicate: true
    };
  }

  const amountKobo = Number(order.amount);

  if (
    !Number.isSafeInteger(amountKobo) ||
    amountKobo <= 0
  ) {
    throw new Error("Paid-order amount is invalid.");
  }

  const payload = {
    name: customerName(order),
    email: clean(order.customer?.email, 254).toLowerCase(),
    phone: clean(order.customer?.phone, 80),
    address: fullAddress(order),
    total: Math.round(amountKobo / 100),
    status: "paid",
    items_json: JSON.stringify(Array.isArray(order.items) ? order.items : []),
    payment_reference: safeReference,
    payment_status: "paid"
  };

  const { data, error } = await grimSupabase
    .from("orders")
    .insert(payload)
    .select("id,payment_reference,status,payment_status")
    .single();

  if (!error && data) {
    return {
      ...data,
      duplicate: false
    };
  }

  /*
   * Two verification requests can arrive almost together.
   * The unique payment_reference index makes this safe.
   */
  if (error?.code === "23505") {
    const raced = await findExisting(safeReference);

    if (raced) {
      return {
        ...raced,
        duplicate: true
      };
    }
  }

  throw error || new Error("Unable to save the paid order.");
}

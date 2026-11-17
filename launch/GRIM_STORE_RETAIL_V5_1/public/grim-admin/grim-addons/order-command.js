/* GRIM Order Command Center v1 | read-only, based on authenticated snapshot */
(function () {
  "use strict";
  const doc = document;
  const root = doc.getElementById("grimOrderCommand");
  if (!root) return;
  const $ = (id) => doc.getElementById(id);
  const state = { orders: [], products: [], generatedAt: null, search: "", focusReturn: null };
  const PAID = new Set(["paid", "success", "successful", "completed"]);
  const CLOSED = new Set(["delivered", "cancelled", "canceled", "refunded", "returned"]);
  const norm = (v) => String(v == null ? "" : v).toLowerCase().trim();
  const idFor = (o) => String(o.id ?? o.order_id ?? "");
  const paid = (o) => !["refunded", "cancelled", "canceled"].includes(norm(o.payment_status || o.paymentStatus || o.status)) && (PAID.has(norm(o.payment_status || o.paymentStatus)) || Boolean(o.paid_at));
  const delivery = (o) => norm(o.delivery_status || o.deliveryStatus || o.status);
  const amount = (o) => Math.max(0, Number(o.total ?? o.amount ?? 0) || 0);
  const money = (n) => new Intl.NumberFormat("en-NG", {style:"currency", currency:"NGN", maximumFractionDigits:0}).format(n);
  const text = (id, value) => {const el = $(id); if (el) el.textContent = String(value == null ? "" : value);};
  const display = (v) => {const s = String(v == null ? "" : v).trim(); return s || "—";};
  const summary = (orders) => ({
    count: orders.length,
    paid: orders.filter(paid),
    unpaid: orders.filter(o => !paid(o) && !CLOSED.has(delivery(o))),
    needsFulfilment: orders.filter(o => paid(o) && !CLOSED.has(delivery(o)))
  });
  const searchable = (o) => [idFor(o), o.name, o.customer_name, o.email, o.phone, o.payment_reference].map(v => String(v ?? "")).join(" ").toLowerCase();
  const currentFiltered = () => {
    const filter = norm($("orderFilter")?.value || "all");
    return state.orders.filter(o => {
      const payment = norm(o.payment_status || o.paymentStatus);
      const shipment = delivery(o);
      const matchesFilter = filter === "all" || payment === filter || shipment === filter;
      return matchesFilter && searchable(o).includes(state.search);
    });
  };
  function reflectRows() {
    const table = $("orderTableBody");
    if (!table) return;
    const allowed = new Set(currentFiltered().map(idFor));
    let visible = 0;
    for (const row of table.querySelectorAll("tr[data-grim-order-id]")) {
      const found = allowed.has(row.dataset.grimOrderId);
      row.hidden = !found;
      if (found) visible++;
    }
    const filtered = currentFiltered();
    text("grimOpsShown", `${visible} visible · ${filtered.length} matching`);
    const empty = $("grimOpsEmpty");
    if (empty) empty.hidden = visible > 0 || !state.orders.length;
  }
  function render() {
    const s = summary(state.orders);
    text("grimOpsRevenue", money(s.paid.reduce((a,o)=>a+amount(o),0)));
    text("grimOpsPaid", s.paid.length);
    text("grimOpsUnpaid", s.unpaid.length);
    text("grimOpsAttention", s.needsFulfilment.length);
    text("grimOpsCatalog", `${state.products.length} catalog products · Stock quantities not tracked here`);
    text("grimOpsSync", state.generatedAt && !Number.isNaN(Date.parse(state.generatedAt)) ? `Synced ${new Intl.DateTimeFormat("en-NG",{dateStyle:"short",timeStyle:"short"}).format(new Date(state.generatedAt))}` : "Waiting for first sync");
    reflectRows();
  }
  function parseItems(raw) {
    if (raw == null) return "Not provided";
    let items=raw;
    if (typeof items === "string") {try {items=JSON.parse(items);} catch {return items || "Not provided";}}
    if (Array.isArray(items)) {
      return items.map(i => {
        if (typeof i === "string") return i;
        if (!i || typeof i !== "object") return String(i);
        return `${i.name || i.title || i.product_name || "Item"} × ${i.quantity || i.qty || 1}${i.size ? ` · ${i.size}` : ""}`;
      }).join("\n") || "No items listed";
    }
    if (items && Array.isArray(items.items)) return parseItems(items.items);
    return JSON.stringify(items);
  }
  function setDetail(label, value) {
    const dl = $("grimOpsDetail");
    const pair = doc.createElement("div"); pair.className="grim-ops__datum";
    const dt=doc.createElement("dt"); dt.textContent=label;
    const dd=doc.createElement("dd"); dd.textContent=display(value);
    pair.append(dt,dd); dl.appendChild(pair);
  }
  function showDetails(id) {
    const o = state.orders.find(item => idFor(item) === id); if (!o) return;
    const dlg=$("grimOpsDrawer"); const dl=$("grimOpsDetail"); if (!dlg || !dl) return;
    state.focusReturn = doc.activeElement;
    dl.replaceChildren();
    text("grimOpsOrderTitle", `Order #${idFor(o)}`);
    const fields = [
      ["Payment", paid(o) ? "Confirmed" : display(o.payment_status || "Pending / unverified")],
      ["Fulfilment", display(delivery(o) || "Not yet set")],
      ["Order total", money(amount(o))],
      ["Customer", o.name || o.customer_name],
      ["Email", o.email],
      ["Phone", o.phone],
      ["Delivery address", o.address],
      ["Items", parseItems(o.items_json ?? o.items)],
      ["Payment reference", o.payment_reference],
      ["Placed", o.created_at && !Number.isNaN(Date.parse(o.created_at)) ? new Date(o.created_at).toLocaleString("en-NG") : "—"]
    ];
    fields.forEach(([label,value])=>setDetail(label,value));
    dlg.hidden=false;
    $("grimOpsCopyId").dataset.orderId=id;
    $("grimOpsClose")?.focus();
  }
  function closeDetails(){const dlg=$("grimOpsDrawer"); if(dlg) dlg.hidden=true; state.focusReturn?.focus?.();}
  const csvCell=(v)=>{let s=String(v == null ? "" : v); if (/^[\s]*[=+@-]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"';};
  function exportCsv() {
    const records=currentFiltered(); if (!records.length){text("grimOpsShown","No matching orders to export");return;}
    const cols=["id","created_at","customer","email","phone","total_ngn","payment_status","fulfilment_status","payment_reference"];
    const rows=[cols,...records.map(o=>[idFor(o),o.created_at,o.name||o.customer_name,o.email,o.phone,amount(o),o.payment_status||"",delivery(o),o.payment_reference])];
    const csv="\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const a=doc.createElement("a");a.href=url;a.download=`GRIM_orders_${new Date().toISOString().slice(0,10)}.csv`;doc.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  $("grimOpsSearch")?.addEventListener("input", (ev)=>{state.search=norm(ev.target.value);reflectRows();});
  $("orderFilter")?.addEventListener("change",reflectRows);
  $("grimOpsExport")?.addEventListener("click",exportCsv);
  $("grimOpsClose")?.addEventListener("click",closeDetails);
  $("grimOpsDrawer")?.addEventListener("click",(ev)=>{if(ev.target === $("grimOpsDrawer")) closeDetails();});
  doc.addEventListener("keydown",(ev)=>{if(ev.key==="Escape" && !$("grimOpsDrawer").hidden) closeDetails();});
  $("grimOpsCopyId")?.addEventListener("click",async (ev)=>{try {await navigator.clipboard.writeText(ev.currentTarget.dataset.orderId);ev.currentTarget.textContent="COPIED";setTimeout(()=>{ev.currentTarget.textContent="COPY ORDER ID";},1400);}catch{ev.currentTarget.textContent="COPY UNAVAILABLE";}});
  $("orderTableBody")?.addEventListener("click",(ev)=>{const button=ev.target.closest("[data-grim-open-order]");if(button)showDetails(button.dataset.grimOpenOrder);});
  window.addEventListener("grim:admin:snapshot",(ev)=>{
    const d=ev.detail || {};
    state.orders=Array.isArray(d.orders)?d.orders:[];
    state.products=Array.isArray(d.products)?d.products:[];
    state.generatedAt=d.generatedAt||null;
    render();
    const pending=new URLSearchParams(window.location.search).get("order");
    if(pending && state.orders.some(o=>idFor(o)===pending)) showDetails(pending);
  });
  window.addEventListener("grim:admin:orders-rendered",reflectRows);
  render();
})();

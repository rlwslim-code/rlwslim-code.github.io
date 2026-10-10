/* Only the Preview checkout entry is replaced. Storefront, account and admin stay intact. */
window.addEventListener("load", async () => {
  try {
    const r = await fetch("/api/checkout2/config", {
        cache: "no-store",
        credentials: "same-origin",
      }),
      c = await r.json();
    if (!c.enabled) return;
    window.openCheckout = () => location.assign("/checkout2.html");
  } catch {}
});

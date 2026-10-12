self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text?.() || "" }; }
  const title = data.title || "GRIM";
  const options = {
    body: data.body || "A new message from GRIM.",
    icon: data.icon || "/grim-icon-192.png",
    badge: data.badge || "/grim-icon-192.png",
    data: { url: data.url || "/", category: data.category || "general" },
    tag: data.category ? `grim-${data.category}` : "grim",
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if (client.url === target && "focus" in client) return client.focus();
    }
    return clients.openWindow ? clients.openWindow(target) : undefined;
  }));
});

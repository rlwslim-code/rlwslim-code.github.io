'use strict';
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* fallback */ }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 100) : 'GRIM Order Alert';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 160) : 'Open GRIM Admin to review.';
  const url = typeof payload.url === 'string' && payload.url.startsWith('/grim-admin/') ? payload.url : '/grim-admin/#orders';
  event.waitUntil(self.registration.showNotification(title, {
    body, tag: String(payload.tag || 'grim-order').slice(0, 120),
    icon: '/grim-admin/notify-icon.svg', badge: '/grim-admin/notify-icon.svg',
    data: { url },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/grim-admin/#orders', self.location.origin);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/grim-admin/')) return;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const windowClient of windows) {
      if (new URL(windowClient.url).origin === url.origin) {
        await windowClient.navigate(url.href);
        return windowClient.focus();
      }
    }
    return clients.openWindow(url.href);
  })());
});

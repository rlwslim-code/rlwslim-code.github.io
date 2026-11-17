(() => {
  'use strict';
  const base = '/api/admin/grim-notify';
  const $ = id => document.getElementById(id);
  const status = text => { $('status').textContent = text; };
  let registration = null;

  function toBytes(base64Url) {
    const pad = '='.repeat((4 - (base64Url.length % 4)) % 4);
    const binary = atob((base64Url + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  }

  async function api(path, method = 'GET', body) {
    const result = await fetch(base + path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await result.json().catch(() => ({}));
    if (result.status === 401) throw new Error('Please sign in to GRIM Admin first, then reload this page.');
    if (!result.ok) throw new Error(`${data.error || 'Request failed'} (${result.status})`);
    return data;
  }

  async function getSubscription() {
    registration ||= await navigator.serviceWorker.register('/grim-admin/notify-sw.js', { scope: '/grim-admin/' });
    return registration.pushManager.getSubscription();
  }

  async function refreshButtons() {
    const active = await getSubscription();
    $('test').disabled = !active;
    $('disable').disabled = !active;
    return active;
  }

  $('enable').addEventListener('click', async () => {
    $('enable').disabled = true;
    status('Requesting notification permission…');
    try {
      const config = await api('/config');
      const existing = await getSubscription();
      if (Notification.permission === 'denied') throw new Error('Notifications are blocked in device settings.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');
      const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(config.publicKey) });
      await api('/subscribe', 'POST', { subscription: subscription.toJSON() });
      status('Enabled. Your device is registered for GRIM order alerts.');
      await refreshButtons();
    } catch (e) { status(e.message || String(e)); }
    finally { $('enable').disabled = false; }
  });

  $('test').addEventListener('click', async () => {
    try {
      status('Sending a test…');
      const subscription = await getSubscription();
      if (!subscription) throw new Error('Enable alerts first.');
      const result = await api('/test', 'POST', { endpoint: subscription.endpoint });
      if (!result.ok) throw new Error('No test alert was sent. Check server logs.');
      status('Test pushed. Check your device notifications.');
    } catch (e) { status(e.message || String(e)); }
  });

  $('disable').addEventListener('click', async () => {
    try {
      const subscription = await getSubscription();
      if (subscription) {
        await api('/unsubscribe', 'POST', { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      status('Notifications disabled for this device.');
      await refreshButtons();
    } catch (e) { status(e.message || String(e)); }
  });

  (async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      status('Web Push unavailable here. On iPhone, use Safari > Share > Add to Home Screen, then open the installed app.');
      $('enable').disabled = true;
      return;
    }
    try {
      const active = await refreshButtons();
      status(active ? 'Push subscription exists. Use Send test to verify delivery.' : 'Ready to enable notifications.');
    } catch (e) { status(e.message || String(e)); }
  })();
})();

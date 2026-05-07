/**
 * Stoop Service Worker — Phase 21 Web Push handler.
 *
 * Minimal: receive `push` events with a JSON body, show a
 * notification.  Click the notification → focus / open the prikbord.
 * Apps that want richer UX layer their own logic on top.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Stoop', body: event.data?.text?.() ?? '' };
  }
  const title = data.title ?? 'Stoop';
  const opts  = {
    body:    data.body ?? '',
    icon:    data.icon ?? '/favicon.ico',
    badge:   data.badge ?? '/favicon.ico',
    data:    data,
    tag:     data.tag,
    renotify: !!data.renotify,
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.endsWith(url) && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

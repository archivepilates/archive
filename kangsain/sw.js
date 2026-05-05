const CACHE_NAME = 'kangsain-v12';
const CORE_ASSETS = [
  './',
  './manifest.webmanifest?v=12',
  './icons/icon-192.png?v=12',
  './icons/icon-512.png?v=12',
  './icons/apple-touch-icon.png?v=12'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('firebasestorage.googleapis.com') || event.request.url.includes('googleapis.com')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { notification: { title: '강사IN', body: event.data ? event.data.text() : '' } };
  }
  const notification = payload.notification || {};
  event.waitUntil(
    self.registration.showNotification(notification.title || '강사IN', {
      body: notification.body || '',
      icon: './icons/icon-192.png?v=12',
      badge: './icons/icon-192.png?v=12',
      data: payload.data || {}
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('./'));
});

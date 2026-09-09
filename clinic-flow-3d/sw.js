/* クリニックタウン3D — Service Worker
 * network-first(常に最新を取りに行き、オフライン時はキャッシュで起動) */
const VER = 'ct3d-v80';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VER).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'ct3d-daily') return;
  e.waitUntil(self.registration.showNotification('クリニックタウン3D', {
    body: '🎁 今日のログインボーナスとスタッフからの依頼が届いています',
    icon: 'icon-192.png',
    tag: 'ct3d-daily'
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow('./'));
});

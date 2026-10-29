// Service worker：收推播、顯示通知、離線時用快取開畫面
const CACHE = 'fc-v1';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 畫面檔案：先抓網路（拿最新版），失敗才用快取；API 不快取
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});

// 推播本身不帶內容，收到後去伺服器拿這台手機還沒看過的提醒
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let alerts = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const res = await fetch('/api/feed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: sub && sub.endpoint }),
      });
      alerts = (await res.json()).alerts || [];
    } catch {
      alerts = [{ id: 'offline', title: '家庭行事曆有新提醒', body: '打開 App 查看' }];
    }
    await Promise.all(alerts.map((a) => self.registration.showNotification(a.title, {
      body: a.body,
      tag: `alert-${a.id}`,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      vibrate: [300, 150, 300, 150, 300],
      requireInteraction: true,
      data: { eventId: a.event_id || null },
    })));
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow('/');
  })());
});

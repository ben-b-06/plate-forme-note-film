// Service worker : fonctionnement hors ligne (réseau d'abord, cache en secours).
const VERSION = 'cinenote-v1';
const SHELL = [
  '/',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/js/app.js',
  '/js/html.js',
  '/js/api.js',
  '/js/store.js',
  '/js/ui.js',
  '/js/ads.js',
  '/js/chart.js',
  '/js/comments.js',
  '/js/pages/home.js',
  '/js/pages/browse.js',
  '/js/pages/title.js',
  '/js/pages/episode.js',
  '/js/pages/search.js',
  '/js/pages/foryou.js',
  '/js/pages/profile.js',
  '/js/pages/premium.js',
  '/js/pages/auth.js',
  '/js/pages/admin.js',
  '/js/pages/about.js',
];
const STATIC = `${VERSION}-static`;
const API = `${VERSION}-api`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear-api') caches.delete(API);
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(request)) || (fallbackUrl && (await caches.match(fallbackUrl)));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // images externes, pubs : gérées par le navigateur
  if (url.pathname.startsWith('/api/admin') || url.pathname.startsWith('/api/cron')) return;
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API));
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC, '/'));
  } else {
    event.respondWith(networkFirst(request, STATIC));
  }
});

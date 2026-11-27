// Service worker: app-bestanden in de cache, zodat de app snel start en
// installeerbaar is. Data van Supabase gaat altijd rechtstreeks over het netwerk.
// Verhoog CACHE bij elke nieuwe versie zodat telefoons de update ophalen.
const CACHE = 'boodschappen-v1.3.0';
const FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/config.js',
  'js/api-supabase.js',
  'js/api-demo.js',
  'js/order.js',
  'js/seed.js',
  'vendor/supabase.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Eerst netwerk (altijd de nieuwste versie); bij geen of traag netwerk
// (slechte ontvangst in de winkel) na 2,5 s de versie uit de cache.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const net = fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    });
    net.catch(() => {});
    try {
      return await Promise.race([net, new Promise((_, reject) => setTimeout(() => reject(new Error('traag')), 2500))]);
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      return hit || net.catch(() => caches.match('index.html'));
    }
  })());
});

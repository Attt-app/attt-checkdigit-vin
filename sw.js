/* Service worker — cache applicatif (mode hors-ligne) */
const CACHE = 'attt-checkdigit-v13';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './vin-logic.js',
  './app.js',
  './wmi-reference.js',
  './manifest.json',
  './assets/Logo.png',
  './assets/eng.traineddata',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Ne jamais mettre en cache l'endpoint d'envoi ni les CDN dynamiques
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => cached))
  );
});

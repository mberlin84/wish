// Service worker: cachea el "app shell" para uso offline.
// Nota: Tesseract.js y sus modelos se cargan desde CDN y necesitan conexión
// la primera vez que escaneas; luego el navegador los suele cachear.

const CACHE = 'mis-laminas-v10';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './js/ocr.js',
  './js/camera.js',
  './js/stickers.js',
  './js/api.js',
  './manifest.json',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Solo gestionamos peticiones de mismo origen; lo de CDN va directo a la red.
  if (url.origin !== self.location.origin) return;
  // Las llamadas a la API nunca se cachean (datos siempre frescos).
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});

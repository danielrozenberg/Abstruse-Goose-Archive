// Service worker — intercepts navigation requests so clean URL routing works.
// index.html is cached on install so it's available even offline for navigation.

const INDEX = new URL('index.html', self.location).href;
const CACHE = 'ag-v1';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.add(INDEX))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(INDEX).then(cached => cached || fetch(INDEX)),
    );
  }
});

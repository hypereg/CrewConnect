const cacheName = 'crewconnect-shell-social-v13';
const assets = ['./', 'index.html', 'social.css?v=3', 'social.js?v=4', 'manifest.webmanifest', 'icon.png', 'icon-large.png',
  'legacy.html', 'style.css?v=27', 'voice.js?v=18', 'duties.js?v=27', 'app.js?v=27',
  'navigation.html', 'ship-map.css', 'ship-map.mjs', 'ship-canvas.mjs', 'ship-data.mjs'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('crewconnect-shell-') && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const page = ['legacy.html', 'navigation.html'].find(name => url.pathname === new URL(name, self.registration.scope).pathname);
  if (event.request.mode === 'navigate' && (page || url.pathname === new URL('./', self.registration.scope).pathname ||
    url.pathname === new URL('index.html', self.registration.scope).pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(page ?? 'index.html')));
    return;
  }
  if (assets.some(asset => new URL(asset, self.registration.scope).href === url.href)) {
    event.respondWith(caches.match(event.request).then(asset => asset || fetch(event.request)));
  }
});

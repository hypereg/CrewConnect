const cacheName = 'crewconnect-shell-social-v6';
const assets = ['./', 'index.html', 'social.css?v=2', 'social.js?v=3', 'manifest.webmanifest', 'icon.png', 'icon-large.png',
  'legacy.html', 'style.css?v=18', 'voice.js?v=18', 'duties.js?v=18', 'app.js?v=20'];
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
  const legacy = url.pathname === new URL('legacy.html', self.registration.scope).pathname;
  if (event.request.mode === 'navigate' && (legacy || url.pathname === new URL('./', self.registration.scope).pathname ||
    url.pathname === new URL('index.html', self.registration.scope).pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(legacy ? './legacy.html' : './index.html')));
    return;
  }
  if (assets.some(asset => new URL(asset, self.registration.scope).href === url.href)) {
    event.respondWith(caches.match(event.request).then(asset => asset || fetch(event.request)));
  }
});

const cacheName = 'crewconnect-shell-social-v37';
const assets = ['./', 'index.html', 'social.css?v=11', 'social.js?v=16', 'manifest.webmanifest', 'icon.png', 'icon-large.png',
  'design.css?v=1', 'design.js?v=1', 'landing.css?v=1', 'assets/interface.svg', 'assets/motion-14.14.0.js',
  'assets/bricolage-latin.woff2', 'assets/bricolage-latin-ext.woff2', 'assets/dm-sans-latin.woff2', 'assets/dm-sans-latin-ext.woff2',
  'assets/wonder.webp', 'assets/wonder-small.webp', 'assets/horizon.webp',
  'profile.css?v=1', 'profile.js?v=1',
  'legacy.html', 'style.css?v=41', 'voice.js?v=18', 'duties.js?v=27', 'app.js?v=41', 'games.js?v=3', 'notifications.js?v=1', 'statistics.js?v=2', 'restaurants.js?v=3',
  'navigation.html', 'ship-map.css?v=7', 'ship-map.mjs?v=9', 'ship-canvas.mjs?v=7', 'ship-data.mjs?v=2'];
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
  url.hash = '';
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

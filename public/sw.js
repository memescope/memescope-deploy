var CACHE_NAME = 'memescope-v2.5.161';
// On localhost the service worker is disabled entirely so development always
// sees fresh files (no stale-cache confusion). Production keeps full caching.
var IS_DEV = /^localhost$|^127\.|^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(self.location.hostname);
var STATIC_ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/embed.js',
  '/wallet.js',
  '/boost.js',
  '/extras.js',
  '/multichart.js',
  '/ens.js',
  '/manifest.json',
  '/favicon.png',
  '/icon-192.png',
  '/img/globe-chains.svg',
  '/img/leaf.svg',
  '/img/worldwide.svg',
  '/img/phantom_logo.png',
  '/img/metamask_logo.svg',
  '/img/coinbase_logo.webp',
  '/img/trust_logo.png',
  '/img/okx_logo.png',
  '/img/chain_solana.png',
  '/img/chain_eth.png',
  '/img/chain_bsc.png'
];

// Install — cache static assets (skipped in dev)
self.addEventListener('install', function(e) {
  self.skipWaiting();
  if (IS_DEV) return;
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate — clean old caches; in dev, wipe everything and remove the SW itself
self.addEventListener('activate', function(e) {
  if (IS_DEV) {
    e.waitUntil(
      caches.keys().then(function(names) {
        return Promise.all(names.map(function(n) { return caches.delete(n); }));
      }).then(function() { return self.registration.unregister(); })
        .then(function() { return self.clients.matchAll(); })
        .then(function(clients) { clients.forEach(function(c) { try { c.navigate(c.url); } catch(err) {} }); })
    );
    return;
  }
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
            .map(function(n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

// Fetch — NETWORK-FIRST for the app shell so new deploys show up immediately;
// the cache is only an offline fallback now (no more stale-version surprises).
self.addEventListener('fetch', function(e) {
  if (IS_DEV) return;  // dev: always go to network, never serve from cache
  var url = new URL(e.request.url);

  // API calls — always network, no cache
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('memescope-scraper') ||
      url.hostname.includes('dexscreener') ||
      url.hostname.includes('geckoterminal')) {
    return;
  }

  // External resources (fonts, analytics) — let browser handle
  if (url.origin !== self.location.origin) {
    return;
  }

  // Same-origin app shell — NETWORK-FIRST: always try the network so the latest
  // deploy is served immediately; fall back to cache only when offline.
  e.respondWith(
    fetch(e.request).then(function(response) {
      if (response.ok) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, copy); });
      }
      return response;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});

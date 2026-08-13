/**
 * ═══════════════════════════════════════════════════════
 * GTA VI COUNTDOWN — Service Worker
 * ═══════════════════════════════════════════════════════
 *
 * Caching strategy: Cache-First with Network Fallback
 *
 * For a countdown page, we want:
 *   - Instant offline loading (the timer runs locally)
 *   - Background image cached (it's 4MB, don't re-fetch)
 *   - Fonts cached after first load
 *   - Update when new version is deployed
 *
 * Cache versioning: bump CACHE_VERSION when deploying
 * changes to force a cache refresh.
 *
 * @file sw.js
 */


/* ─── Cache Configuration ─── */

const CACHE_VERSION = 'gtavi-v5';

/**
 * Assets to pre-cache during installation.
 * These are the critical assets needed for offline use.
 * The artwork is large but essential for the experience.
 */
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/artwork.webp',
  '/logo.webp',
  '/manifest.webmanifest',
  '/audio/playlist.json',
  '/audio/countdown/tick.m4a',
  '/audio/countdown/tock.m4a',
  '/icons/favicon-32x32.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

/**
 * External URLs to cache on first request.
 * Google Fonts are cached after the first load
 * so they work offline on subsequent visits.
 */
const EXTERNAL_CACHE_PATTERNS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];


/* ─── Install Event ─── */

/**
 * Pre-caches critical assets during service worker installation.
 * skipWaiting() ensures the new SW takes over immediately
 * instead of waiting for all tabs to close.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => {
        console.log('[SW] Pre-caching critical assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((error) => {
        console.error('[SW] Pre-cache failed:', error);
      })
  );
});


/* ─── Activate Event ─── */

/**
 * Cleans up old cache versions when a new SW activates.
 * This prevents stale assets from accumulating.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_VERSION)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});


/* ─── Fetch Event ─── */

/**
 * Intercepts network requests and serves from cache when available.
 *
 * Strategy:
 *   - Cache-first for same-origin assets (HTML, CSS, JS, images)
 *   - Cache-first for external fonts (after first fetch)
 *   - Network-only for everything else
 *
 * When a cached asset is served, we also fire a background
 * fetch to update the cache for next time (stale-while-revalidate
 * for the main page).
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  /* Only handle GET requests */
  if (event.request.method !== 'GET') return;

  /* Check if this is an external URL we want to cache */
  const isExternalCacheable = EXTERNAL_CACHE_PATTERNS.some(
    (pattern) => url.hostname.includes(pattern)
  );

  /* Same-origin or cacheable external */
  if (url.origin === self.location.origin || isExternalCacheable) {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            /*
             * Serve from cache immediately.
             * For the HTML page, also fetch in background
             * to keep the cache fresh.
             */
            if (event.request.destination === 'document') {
              updateCache(event.request);
            }
            return cachedResponse;
          }

          /* Not in cache — fetch from network and cache it */
          return fetchAndCache(event.request);
        })
        .catch(() => {
          /* Both cache and network failed */
          if (event.request.destination === 'document') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503 });
        })
    );
  }
});


/* ─── Helper Functions ─── */

/**
 * Fetches a request from the network and adds the
 * response to the cache.
 *
 * @param {Request} request - The fetch request
 * @returns {Promise<Response>} The network response
 */
async function fetchAndCache(request) {
  const response = await fetch(request);

  /* Only cache successful responses */
  if (response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    /* Clone the response — it can only be consumed once */
    cache.put(request, response.clone());
  }

  return response;
}

/**
 * Updates a cached asset in the background.
 * Used for stale-while-revalidate on the HTML page.
 *
 * @param {Request} request - The fetch request to update
 */
async function updateCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(request, response);
    }
  } catch {
    /* Silently fail — the cached version is still valid */
  }
}

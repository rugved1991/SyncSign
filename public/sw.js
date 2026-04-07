const APP_CACHE = 'syncsign-app-v1'
const IMG_CACHE = 'syncsign-images-v1'
const STATE_CACHE = 'syncsign-state-v1'

const APP_SHELL = [
  '/syncsign/',
  '/syncsign/controller/',
  '/syncsign/display/',
]

// ── Install: cache app shell ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  )
  self.skipWaiting()
})

// ── Activate: clean old caches ────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(k => k !== APP_CACHE && k !== IMG_CACHE && k !== STATE_CACHE)
          .map(k => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

// ── Fetch: cache strategies ───────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Google Drive images — cache-first (they never change once uploaded)
  if (url.hostname === 'drive.google.com' || url.hostname === 'lh3.googleusercontent.com') {
    event.respondWith(cacheFirstStrategy(event.request, IMG_CACHE))
    return
  }

  // App shell — network-first (always try to get latest, fall back to cache)
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirstStrategy(event.request, APP_CACHE))
    return
  }

  // Everything else — network only
})

async function cacheFirstStrategy(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return cached || new Response('', { status: 503 })
  }
}

async function networkFirstStrategy(request, cacheName) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cache = await caches.open(cacheName)
    const cached = await cache.match(request)
    return cached || new Response('Offline', { status: 503 })
  }
}

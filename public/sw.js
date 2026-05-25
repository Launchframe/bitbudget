/* BitBudget service worker — shell resilience; API always network-first. */
const CACHE = "bitbudget-shell-v1"
const SHELL = ["/", "/icon.svg", "/apple-icon.svg", "/manifest.webmanifest"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/") || caches.match(event.request)),
    )
    return
  }

  if (event.request.destination === "script" || event.request.destination === "style") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request)),
    )
  }
})

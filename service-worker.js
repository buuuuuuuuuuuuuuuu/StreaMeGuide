const APP_VERSION = "0.3.0";
const CACHE_NAME = `streamguide-v${APP_VERSION}`;
const SHELL_FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.json",
  "onboarding-prompt.md",
  "recommendations.sample.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  // Kein self.skipWaiting() hier: der neue Service Worker soll erst
  // aktiv werden, wenn der Nutzer im "Neue Version verfügbar"-Banner
  // auf "Jetzt laden" tippt (siehe app.js + message-Listener unten).
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // recommendations.json: network-first, so daily updates land immediately when online
  if (url.pathname.endsWith("recommendations.json")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // app shell: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

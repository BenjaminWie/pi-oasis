const CACHE_NAME = "pi-hub-cache-v1";

self.addEventListener("install", (event) => {
  // Service worker installed
});

self.addEventListener("fetch", (event) => {
  // Basic fetch handler to satisfy PWA requirements
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    }),
  );
});

const scope = new URL(self.registration.scope);
const cachePrefix = "impulsafit-ems:" + scope.pathname + ":";
const cacheName = cachePrefix + "v1";
const home = new URL("index.html", scope).href;
const assets = new Set([
  "index.html",
  "app.css",
  "app.js",
  "client-store.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable.png",
  "apple-touch-icon.png",
].map((file) => new URL(file, scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([...assets].map((asset) => new Request(asset, { cache: "reload" })));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin) return;

  const isHome = url.pathname === scope.pathname || url.pathname === new URL(home).pathname;
  if (request.mode === "navigate" && isHome) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(home)) ?? fetch(request);
    })());
  } else if (assets.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(request)) ?? fetch(request);
    })());
  }
});

const scope = new URL(self.registration.scope);
const cachePrefix = "impulsafit-ems:" + scope.pathname + ":";
const cacheName = cachePrefix + "v15";
const ocrCacheName = "impulsafit-ocr:6.0.1:" + scope.pathname;
const home = new URL("index.html", scope).href;
const manifest = new URL("manifest.webmanifest", scope).href;
const assets = new Set([
  "index.html",
  "app.css",
  "app.js",
  "client-store.js",
  "ems-panel.js",
  "ems-sessions.js",
  "ems-ocr.js",
  "ems-photo.js",
  "wiems-values.js",
  "manifest.webmanifest",
  "icon-192.png?v=7",
  "icon-512.png?v=7",
  "icon-maskable.png?v=7",
  "apple-touch-icon.png?v=7",
].map((file) => new URL(file, scope).href));

const ocrAssets = new Set([
  "tesseract.min.js",
  "worker.min.js",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "eng.traineddata.gz",
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

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
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
  } else if (url.href === manifest) {
    event.respondWith((async () => {
      // Chrome uses the manifest to check the name and icon of the installed app.
      const response = await fetch(request, { cache: "no-cache" }).catch(() => null);
      if (response?.ok) return response;
      const cache = await caches.open(cacheName);
      return (await cache.match(request)) ?? response ?? Response.error();
    })());
  } else if (assets.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(request)) ?? fetch(request);
    })());
  } else if (ocrAssets.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(ocrCacheName);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone()).catch(() => {});
      return response;
    })());
  }
});

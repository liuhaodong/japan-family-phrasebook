const CACHE_NAME = "japan-family-phrasebook-v10";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=10",
  "./app.js?v=10",
  "./oral_coach.js?v=10",
  "./learning.js?v=10",
  "./manifest.json?v=10",
  "./vendor/leaflet/leaflet.css?v=10",
  "./vendor/leaflet/leaflet.js?v=10",
  "./data/itinerary.js?v=10",
  "./data/modules_1_to_6.js?v=10",
  "./data/modules_7_to_12.js?v=10",
  "./data/modules_13_to_18.js?v=10",
  "./data/audio_manifest.js?v=10",
  "./data/audio_learning_manifest.js?v=10",
  "./data/verbs_top200.js?v=10",
  "./data/grammar_n5_n3.js?v=10",
  "./data/learning_extras.js?v=10"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        ASSETS.map((url) =>
          fetch(new Request(url, { cache: "reload" }))
            .then((res) => {
              if (res.ok) return cache.put(url, res);
            })
            .catch(() => {})
        )
      )
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Never intercept cross-origin requests (map tiles, external CDNs, QR API)
  try {
    const reqUrl = new URL(req.url);
    if (reqUrl.origin !== self.location.origin) {
      return;
    }
  } catch (e) {
    return;
  }

  // Let browser handle MP3 audio & byte-range requests natively
  if (req.url.includes(".mp3") || req.headers.has("range")) {
    return;
  }

  // Network-first for same-origin HTML/JS/CSS/Data with offline cache fallback
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req, { ignoreSearch: true });
        return cached || new Response("Offline", { status: 503, statusText: "Offline" });
      })
  );
});

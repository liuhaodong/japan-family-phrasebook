const CACHE_NAME = "japan-family-phrasebook-v41";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=37",
  "./app.js?v=32",
  "./oral_coach.js?v=32",
  "./learning.js?v=36",
  "./sensei_ui.js?v=37",
  "./live_audio_worklet.js?v=19",
  "./manifest.json?v=20",
  "./vendor/leaflet/leaflet.css?v=18",
  "./vendor/leaflet/leaflet.js?v=18",
  "./data/itinerary.js?v=18",
  "./data/modules_1_to_6.js?v=18",
  "./data/modules_7_to_12.js?v=18",
  "./data/modules_13_to_18.js?v=18",
  "./data/audio_manifest.js?v=18",
  "./data/audio_learning_manifest.js?v=18",
  "./data/verbs_top200.js?v=18",
  "./data/grammar_n5_n3.js?v=18",
  "./data/video_grammar.js?v=18",
  "./data/learning_extras.js?v=18"
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

  // Never intercept cross-origin requests or backend API / WebSocket / audio byte-range requests
  let reqUrl;
  try {
    reqUrl = new URL(req.url);
    if (reqUrl.origin !== self.location.origin) {
      return;
    }
  } catch (e) {
    return;
  }

  if (
    reqUrl.pathname.startsWith("/api/") ||
    reqUrl.pathname.startsWith("/ws/") ||
    req.url.includes(".mp3") ||
    req.url.includes(".wav") ||
    req.headers.has("range")
  ) {
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

// サクズの Service Worker（オフラインで全機能を動かす。F-017）
const VERSION = "SZ-0.3.0"; // src/version.js と同じ値にする（scripts/check-version.mjs で確認）
const CACHE = `sakuzu-${VERSION}`;
const FILES = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "src/version.js", "src/ui/app.js", "src/ui/styles.css", "src/ui/messages.js", "src/ui/sheet.js", "src/ui/annot-svg.js",
  "src/model/document.js", "src/model/solver.js", "src/model/edit.js", "src/model/elements.js", "src/model/history.js", "src/model/annot.js",
  "src/shared/geometry.js", "src/shared/construct.js", "src/shared/round.js", "src/shared/rotate.js", "src/shared/print.js", "src/shared/date.js"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("sakuzu-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});

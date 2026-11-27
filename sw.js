// サクズの Service Worker（オフラインで全機能を動かす。F-017）
const VERSION = "SZ-0.6.2"; // src/version.js と同じ値にする（scripts/check-version.mjs で確認）
const CACHE = `sakuzu-${VERSION}`;
const FILES = [
  "./", "index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-192.png", "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png", "icons/favicon.svg", "icons/favicon-32.png",
  "fonts/BIZUDPGothic-Regular.woff2", "fonts/BIZUDPGothic-Bold.woff2",
  "src/version.js", "src/ui/app.js", "src/ui/styles.css", "src/ui/messages.js", "src/ui/sheet.js", "src/ui/annot-svg.js", "src/ui/import-view.js",
  "src/model/document.js", "src/model/solver.js", "src/model/edit.js", "src/model/elements.js", "src/model/history.js", "src/model/annot.js", "src/model/importdoc.js", "src/model/dxfexport.js", "src/model/symbols.js",
  "src/shared/geometry.js", "src/shared/construct.js", "src/shared/round.js", "src/shared/rotate.js", "src/shared/print.js", "src/shared/date.js", "src/shared/importers.js", "src/shared/triangulate.js", "src/shared/sansha.js", "src/shared/sjis.js", "src/shared/dxfwriter.js"];
self.addEventListener("install", (e) => {
  // 新版の事前キャッシュには、HTTP キャッシュを使わずにファイルを取り直す。
  const requests = FILES.map((file) => new Request(file, { cache: "reload" }));
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(requests)));
});
self.addEventListener("message", (e) => { if (e.data === "SKIP_WAITING") self.skipWaiting(); }); // 「更新する」で待機中の新版にすぐ切り替える
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("sakuzu-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});

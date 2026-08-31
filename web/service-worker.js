const CACHE_NAME = "arcadeer-v185";
const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./fade.js",
  "./console-log.js",
  "./footer-log.js",
  "./message-dialog.js",
  "./idb.js",
  "./handle-store.js",
  "./draft-store.js",
  "./i18n.js",
  "./sw-update.js",
  "./settings-dialog.js",
  "./editor.js",
  "./keybinding.js",
  "./font-size.js",
  "./asset-picker.js",
  "./asset-map.js",
  "./asset-map-ui.js",
  "./audio-preview.js",
  "./model-preview.js",
  "./reorder.js",
  "./runtime.js",
  "./coffee.js",
  "./glb.js",
  "./matrix.js",
  "./camera.js",
  "./light.js",
  "./globals.js",
  "./random.js",
  "./collision.js",
  "./debug-draw.js",
  "./draw-order.js",
  "./shadow-cast.js",
  "./gamepad.js",
  "./gamepad-config.js",
  "./gamepad-config-ui.js",
  "./icons/gamepad.svg",
  "./reference.js",
  "./reference/structure.js",
  "./reference/ja.json",
  "./reference/en.json",
  "./reference/zh-Hans.json",
  "./reference/zh-Hant.json",
  "./reference/ko.json",
  "./reference/es.json",
  "./reference/fr.json",
  "./reference/de.json",
  "./reference/it.json",
  "./reference/nl.json",
  "./reference/pt.json",
  "./animation.js",
  "./scene.js",
  "./primitive.js",
  "./kind.js",
  "./color.js",
  "./renderer.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/logo.svg",
  "./locales/ja.json",
  "./locales/en.json",
  "./locales/zh-Hans.json",
  "./locales/zh-Hant.json",
  "./locales/ko.json",
  "./locales/es.json",
  "./locales/fr.json",
  "./locales/de.json",
  "./locales/it.json",
  "./locales/nl.json",
  "./locales/pt.json",
  "./templates/assets/default-icon.png",
  "./templates/assets/default-cat.glb",
  "./pkg/arcadeer.js",
  "./pkg/arcadeer_bg.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // **HTTPキャッシュを通さずに**取り直す。ここで古い中身を保存すると、
      // オフラインの間ずっと古い版が出続けてしまう
      cache
        .addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })))
        .catch(() => undefined),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

// ネットワーク優先。取得できたら最新を返しつつキャッシュを更新し、
// オフライン時だけキャッシュへフォールバックする。
// （キャッシュ優先だと、更新したJS/CSS/WASMが反映されず古い挙動のままになるため）
//
// 取得は **HTTPキャッシュを通さない**。配信元が付ける Cache-Control のせいで
// 古い中身が返ることがあり、「ネットワーク優先」が名ばかりになるため。
// 変更が無ければ 304 が返るので、通信量はほとんど増えない。
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // `fetch(req, {...})` は、画面遷移の要求から作り直せずに落ちる。
  // URL から組み直して、確実に確認付きの取得にする
  const request = new Request(req.url, { cache: "no-cache", credentials: "same-origin" });
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});

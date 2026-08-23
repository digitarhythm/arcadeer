// Service Worker（配信物の取り回し）と、更新の見張りのテスト
//
// Service Worker はワーカーの中でしか動かないため、**偽の環境を用意して
// その場で実行する**。文字列を眺めるだけの確認では、実際の振る舞いを守れない。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { registerServiceWorker } from "../web/sw-update.js";

const SW_SOURCE = readFileSync(new URL("../web/service-worker.js", import.meta.url), "utf8");

/** 取得した中身を表す、最小限の返事 */
function 返事(body = "中身", { status = 200, type = "basic" } = {}) {
  return { body, status, type, clone: () => 返事(body, { status, type }) };
}

/** 偽の Request（初期化の指定を覚えておく） */
class FakeRequest {
  constructor(input, init = {}) {
    this.url = typeof input === "string" ? input : input.url;
    this.method = init.method ?? input?.method ?? "GET";
    this.mode = init.mode ?? "cors";
    this.cache = init.cache ?? "default";
  }
}

/**
 * Service Worker を偽の環境で読み込み、登録された処理を取り出す
 */
function loadServiceWorker({ fetchImpl } = {}) {
  const handlers = {};
  const 保存 = [];
  const 箱 = new Map();

  const cache = {
    addAll: (list) => { 保存.push(...list); return Promise.resolve(); },
    put: (req, res) => { 箱.set(req.url ?? req, res); return Promise.resolve(); },
  };
  const caches = {
    open: () => Promise.resolve(cache),
    keys: () => Promise.resolve(["arcadeer-古い"]),
    delete: () => Promise.resolve(true),
    match: (req) => Promise.resolve(箱.get(req.url ?? req) ?? null),
  };

  const 取得の記録 = [];
  const fetch = (req, init) => {
    取得の記録.push({ req, init });
    return (fetchImpl ?? (() => Promise.resolve(返事())))(req, init);
  };

  const self = {
    addEventListener: (種類, fn) => { handlers[種類] = fn; },
    skipWaiting: () => { handlers.skipWaitingを呼んだ = true; },
    clients: { claim: () => { handlers.claimを呼んだ = true; } },
  };

  // eslint-disable-next-line no-new-func
  new Function("self", "caches", "fetch", "Request", SW_SOURCE)(self, caches, fetch, FakeRequest);

  return { handlers, 保存, 箱, 取得の記録 };
}

/** fetch の出来事を作る */
function fetchEvent(url, { method = "GET", mode = "cors" } = {}) {
  const event = {
    request: new FakeRequest(url, { method, mode }),
    respondWith: (p) => { event.応答 = p; },
  };
  return event;
}

describe("Service Worker の取り回し", () => {
  test("配信物は HTTPキャッシュを通さずに取りに行く", () => {
    // 「ネットワーク優先」と言いつつHTTPキャッシュが返ると、更新が届かない
    const { handlers, 取得の記録 } = loadServiceWorker();
    handlers.fetch(fetchEvent("https://例/style.css"));
    expect(取得の記録).toHaveLength(1);
    expect(取得の記録[0].req.cache).toBe("no-cache");
  });

  test("取れたらキャッシュも新しくする", async () => {
    const { handlers, 箱 } = loadServiceWorker();
    const event = fetchEvent("https://例/style.css");
    handlers.fetch(event);
    await event.応答;
    expect(箱.get("https://例/style.css")).toBeTruthy();
  });

  test("オフラインならキャッシュから返す", async () => {
    let 回数 = 0;
    const { handlers } = loadServiceWorker({
      fetchImpl: () => (回数++ === 0 ? Promise.resolve(返事("新しい")) : Promise.reject(new Error("オフライン"))),
    });
    // 一回目でキャッシュへ入れておく
    const 一回目 = fetchEvent("https://例/style.css");
    handlers.fetch(一回目);
    await 一回目.応答;

    // 二回目は取得に失敗するが、キャッシュから返る
    const 二回目 = fetchEvent("https://例/style.css");
    handlers.fetch(二回目);
    expect((await 二回目.応答).body).toBe("新しい");
  });

  test("GET 以外は横取りしない", () => {
    const { handlers, 取得の記録 } = loadServiceWorker();
    const event = fetchEvent("https://例/save", { method: "POST" });
    handlers.fetch(event);
    expect(event.応答).toBeUndefined();
    expect(取得の記録).toHaveLength(0);
  });

  test("最初のキャッシュ作りも、HTTPキャッシュを通さない", async () => {
    // ここで古い内容を保存すると、オフラインの間ずっと古い版が出てしまう
    const { handlers, 保存 } = loadServiceWorker();
    let 待つもの = null;
    handlers.install({ waitUntil: (p) => { 待つもの = p; } });
    await 待つもの;
    expect(保存.length).toBeGreaterThan(10);
    expect(保存.every((r) => r.cache === "reload")).toBe(true);
  });

  test("入れ替わったら、古いキャッシュを捨てる", () => {
    const { handlers } = loadServiceWorker();
    expect(typeof handlers.activate).toBe("function");
    handlers.activate({ waitUntil: () => {} });
  });
});

/** 偽の navigator.serviceWorker */
function fakeContainer({ controller = null, registerFails = false, updateFails = false } = {}) {
  const 聞き手 = {};
  const 記録 = { register: null, update: 0 };
  return {
    controller,
    記録,
    聞き手,
    addEventListener: (種類, fn) => { 聞き手[種類] = fn; },
    register: (url, options) => {
      記録.register = { url, options };
      if (registerFails) return Promise.reject(new Error("登録できない"));
      return Promise.resolve({
        update: () => {
          記録.update += 1;
          return updateFails ? Promise.reject(new Error("オフライン")) : Promise.resolve();
        },
      });
    },
  };
}

describe("更新の見張り", () => {
  test("対応していない環境では何もしない", async () => {
    expect(await registerServiceWorker(undefined)).toBeNull();
    expect(await registerServiceWorker({})).toBeNull();
  });

  test("本体は HTTPキャッシュを通さずに確かめる", async () => {
    const sw = fakeContainer();
    await registerServiceWorker(sw);
    expect(sw.記録.register.url).toBe("./service-worker.js");
    expect(sw.記録.register.options).toEqual({ updateViaCache: "none" });
  });

  test("開いた時点で更新を確かめる", async () => {
    const sw = fakeContainer();
    await registerServiceWorker(sw);
    expect(sw.記録.update).toBe(1);
  });

  test("登録できなくても落ちない", async () => {
    const sw = fakeContainer({ registerFails: true });
    expect(await registerServiceWorker(sw)).toBeNull();
  });

  test("オフラインで確かめられなくても落ちない", async () => {
    const sw = fakeContainer({ updateFails: true });
    expect(await registerServiceWorker(sw)).not.toBeNull();
  });

  test("新しい版が動き出したら知らせる", async () => {
    const sw = fakeContainer({ controller: { state: "activated" } });
    let 知らせ = 0;
    await registerServiceWorker(sw, () => { 知らせ += 1; });
    sw.聞き手.controllerchange();
    expect(知らせ).toBe(1);
  });

  test("初めての登録では知らせない", async () => {
    // 初回も controllerchange は起きるが、これは「更新」ではない
    const sw = fakeContainer({ controller: null });
    let 知らせ = 0;
    await registerServiceWorker(sw, () => { 知らせ += 1; });
    sw.聞き手.controllerchange();
    expect(知らせ).toBe(0);
  });

  test("知らせ先を渡さなくても落ちない", async () => {
    const sw = fakeContainer({ controller: {} });
    await registerServiceWorker(sw);
    sw.聞き手.controllerchange();
  });
});

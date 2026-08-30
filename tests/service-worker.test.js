// Service Worker（配信物の取り回し）と、更新の見張りのテスト
//
// Service Worker はワーカーの中でしか動かないため、**偽の環境を用意して
// その場で実行する**。文字列を眺めるだけの確認では、実際の振る舞いを守れない。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { registerServiceWorker } from "../web/sw-update.js";

const SW_SOURCE = readFileSync(new URL("../web/service-worker.js", import.meta.url), "utf8");

/** 取得した中身を表す、最小限の返事 */
function reply(body = "中身", { status = 200, type = "basic" } = {}) {
  return { body, status, type, clone: () => reply(body, { status, type }) };
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
  const stored = [];
  const box = new Map();

  const cache = {
    addAll: (list) => { stored.push(...list); return Promise.resolve(); },
    put: (req, res) => { box.set(req.url ?? req, res); return Promise.resolve(); },
  };
  const caches = {
    open: () => Promise.resolve(cache),
    keys: () => Promise.resolve(["arcadeer-古い"]),
    delete: () => Promise.resolve(true),
    match: (req) => Promise.resolve(box.get(req.url ?? req) ?? null),
  };

  const fetchLog = [];
  const fetch = (req, init) => {
    fetchLog.push({ req, init });
    return (fetchImpl ?? (() => Promise.resolve(reply())))(req, init);
  };

  const self = {
    addEventListener: (kinds, fn) => { handlers[kinds] = fn; },
    skipWaiting: () => { handlers.skipWaitingCalled = true; },
    clients: { claim: () => { handlers.claimCalled = true; } },
  };

  // eslint-disable-next-line no-new-func
  new Function("self", "caches", "fetch", "Request", SW_SOURCE)(self, caches, fetch, FakeRequest);

  return { handlers, stored, box, fetchLog };
}

/** fetch の出来事を作る */
function fetchEvent(url, { method = "GET", mode = "cors" } = {}) {
  const event = {
    request: new FakeRequest(url, { method, mode }),
    respondWith: (p) => { event.answer = p; },
  };
  return event;
}

describe("Service Worker の取り回し", () => {
  test("配信物は HTTPキャッシュを通さずに取りに行く", () => {
    // 「ネットワーク優先」と言いつつHTTPキャッシュが返ると、更新が届かない
    const { handlers, fetchLog } = loadServiceWorker();
    handlers.fetch(fetchEvent("https://例/style.css"));
    expect(fetchLog).toHaveLength(1);
    expect(fetchLog[0].req.cache).toBe("no-cache");
  });

  test("取れたらキャッシュも新しくする", async () => {
    const { handlers, box } = loadServiceWorker();
    const event = fetchEvent("https://例/style.css");
    handlers.fetch(event);
    await event.answer;
    expect(box.get("https://例/style.css")).toBeTruthy();
  });

  test("オフラインならキャッシュから返す", async () => {
    let times = 0;
    const { handlers } = loadServiceWorker({
      fetchImpl: () => (times++ === 0 ? Promise.resolve(reply("新しい")) : Promise.reject(new Error("オフライン"))),
    });
    // 一回目でキャッシュへ入れておく
    const first = fetchEvent("https://例/style.css");
    handlers.fetch(first);
    await first.answer;

    // 二回目は取得に失敗するが、キャッシュから返る
    const second = fetchEvent("https://例/style.css");
    handlers.fetch(second);
    expect((await second.answer).body).toBe("新しい");
  });

  test("GET 以外は横取りしない", () => {
    const { handlers, fetchLog } = loadServiceWorker();
    const event = fetchEvent("https://例/save", { method: "POST" });
    handlers.fetch(event);
    expect(event.answer).toBeUndefined();
    expect(fetchLog).toHaveLength(0);
  });

  test("最初のキャッシュ作りも、HTTPキャッシュを通さない", async () => {
    // ここで古い内容を保存すると、オフラインの間ずっと古い版が出てしまう
    const { handlers, stored } = loadServiceWorker();
    let pending = null;
    handlers.install({ waitUntil: (p) => { pending = p; } });
    await pending;
    expect(stored.length).toBeGreaterThan(10);
    expect(stored.every((r) => r.cache === "reload")).toBe(true);
  });

  test("入れ替わったら、古いキャッシュを捨てる", () => {
    const { handlers } = loadServiceWorker();
    expect(typeof handlers.activate).toBe("function");
    handlers.activate({ waitUntil: () => {} });
  });
});

/** 偽の navigator.serviceWorker */
function fakeContainer({ controller = null, registerFails = false, updateFails = false } = {}) {
  const listeners = {};
  const log = { register: null, update: 0 };
  return {
    controller,
    log,
    listeners,
    addEventListener: (kinds, fn) => { listeners[kinds] = fn; },
    register: (url, options) => {
      log.register = { url, options };
      if (registerFails) return Promise.reject(new Error("登録できない"));
      return Promise.resolve({
        update: () => {
          log.update += 1;
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
    expect(sw.log.register.url).toBe("./service-worker.js");
    expect(sw.log.register.options).toEqual({ updateViaCache: "none" });
  });

  test("開いた時点で更新を確かめる", async () => {
    const sw = fakeContainer();
    await registerServiceWorker(sw);
    expect(sw.log.update).toBe(1);
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
    let notices = 0;
    await registerServiceWorker(sw, () => { notices += 1; });
    sw.listeners.controllerchange();
    expect(notices).toBe(1);
  });

  test("初めての登録では知らせない", async () => {
    // 初回も controllerchange は起きるが、これは「更新」ではない
    const sw = fakeContainer({ controller: null });
    let notices = 0;
    await registerServiceWorker(sw, () => { notices += 1; });
    sw.listeners.controllerchange();
    expect(notices).toBe(0);
  });

  test("知らせ先を渡さなくても落ちない", async () => {
    const sw = fakeContainer({ controller: {} });
    await registerServiceWorker(sw);
    sw.listeners.controllerchange();
  });
});

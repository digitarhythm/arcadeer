// ゲーム起動時のバナー表示（web/splash.js）のテスト
//
// 起動のたびに「ARCADEER」のバナーをフェードイン／アウトし、
// モバイルブラウザでは「画面をタップしてください」の文言を出して
// タップを待ってから（音を鳴らせる状態にしてから）ゲームを始める。
// 時間待ちと音の解放は差し替えられるようにしてあり、実時間を待たずに確かめる。
import { describe, expect, test } from "bun:test";
import {
  SPLASH_TIMING,
  BANNER_SRC,
  isMobileBrowser,
  runSplash,
  cancelSplash,
} from "../web/splash.js";

/** 偽の要素。クラス・子要素・イベントの聞き手だけを持つ */
class FakeElement {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.className = "";
    this.textContent = "";
    this.attributes = {};
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    const set = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => set.add(n)),
      remove: (...names) => names.forEach((n) => set.delete(n)),
      contains: (n) => set.has(n),
      toggle: (n, force) => (force ?? !set.has(n) ? set.add(n) : set.delete(n)),
    };
  }
  get offsetWidth() {
    return 100;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    nodes.forEach((n) => this.appendChild(n));
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  /** テストから、登録された聞き手を呼ぶ（タップの代わり） */
  fire(type) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type, preventDefault() {} });
  }
  querySelector(selector) {
    const cls = selector.replace(/^\./, "");
    const walk = (el) => {
      for (const c of el.children) {
        if (c.classList.contains(cls)) return c;
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }
}

const fakeDocument = {
  createElement(tag) {
    return new FakeElement(tag, fakeDocument);
  },
};

/** 偽の時間待ち。呼ばれた長さを記録し、テスト側が好きな順に進める */
function fakeWaiter() {
  const calls = [];
  const wait = (ms) =>
    new Promise((resolve) => {
      calls.push({ ms, resolve });
    });
  /** 最も古い待ちを終える */
  const advance = async () => {
    const next = calls.find((c) => !c.done);
    if (!next) throw new Error("no pending wait");
    next.done = true;
    next.resolve();
    await flush();
  };
  const pending = () => calls.filter((c) => !c.done).map((c) => c.ms);
  const history = () => calls.map((c) => c.ms);
  return { wait, advance, pending, history };
}

/** 溜まったマイクロタスクを流す */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** 容器と、差し替えた部品をまとめて用意する */
function setup({ mobile }) {
  const container = new FakeElement("div", fakeDocument);
  const waiter = fakeWaiter();
  const unlocked = [];
  const promise = runSplash(container, {
    mobile,
    wait: waiter.wait,
    unlock: () => {
      unlocked.push(true);
      return Promise.resolve(true);
    },
    t: (key) => `[${key}]`,
  });
  const overlay = () => container.children[0] ?? null;
  const banner = () => overlay()?.querySelector(".game-splash-banner") ?? null;
  const tap = () => overlay()?.querySelector(".game-splash-tap") ?? null;
  return { container, waiter, unlocked, promise, overlay, banner, tap };
}

describe("表示の長さ", () => {
  test("フェードイン 0.5秒、表示 1秒、フェードアウト 0.5秒", () => {
    expect(SPLASH_TIMING).toEqual({ fadeIn: 500, hold: 1000, fadeOut: 500 });
  });

  test("バナー画像は icons/banner.png", () => {
    expect(BANNER_SRC).toBe("./icons/banner.png");
  });
});

describe("モバイルブラウザの判定", () => {
  test("Android と iPhone はモバイル", () => {
    expect(isMobileBrowser({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36", maxTouchPoints: 5 })).toBe(true);
    expect(isMobileBrowser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1", maxTouchPoints: 5 })).toBe(true);
  });

  test("iPad は Mac を名乗っていてもタッチ点の数でモバイル扱いにする", () => {
    expect(isMobileBrowser({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", maxTouchPoints: 5 })).toBe(true);
  });

  test("Mac と Windows のデスクトップはモバイルではない", () => {
    expect(isMobileBrowser({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36", maxTouchPoints: 0 })).toBe(false);
    expect(isMobileBrowser({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36", maxTouchPoints: 0 })).toBe(false);
  });

  test("情報が無ければモバイルではないとみなす", () => {
    expect(isMobileBrowser({})).toBe(false);
    expect(isMobileBrowser()).toBe(false);
  });
});

describe("デスクトップでの起動（タップ不要）", () => {
  test("バナーだけをフェードイン→表示→フェードアウトしてから終わる", async () => {
    const s = setup({ mobile: false });
    await flush();

    // 画面が容器へ加わり、バナー画像と文言を持つ
    expect(s.overlay()).not.toBeNull();
    expect(s.overlay().classList.contains("game-splash")).toBe(true);
    expect(s.banner().tagName).toBe("IMG");
    expect(s.banner().getAttribute("src")).toBe(BANNER_SRC);
    expect(s.banner().getAttribute("alt")).toBe("ARCADEER");

    // フェードイン中
    expect(s.banner().classList.contains("splash-visible")).toBe(true);
    expect(s.waiter.pending()).toEqual([SPLASH_TIMING.fadeIn]);
    await s.waiter.advance();

    // 表示中。文言は出さず、タップも待たない
    expect(s.waiter.pending()).toEqual([SPLASH_TIMING.hold]);
    expect(s.tap().classList.contains("splash-visible")).toBe(false);
    await s.waiter.advance();

    // フェードアウト中
    expect(s.banner().classList.contains("splash-visible")).toBe(false);
    expect(s.waiter.pending()).toEqual([SPLASH_TIMING.fadeOut]);
    expect(s.overlay()).not.toBeNull();
    await s.waiter.advance();

    // 終わったら画面を片付ける
    expect(s.overlay()).toBeNull();
    expect(s.unlocked.length).toBe(0);
    await expect(s.promise).resolves.toEqual({ done: true, tapped: false });
    expect(s.waiter.history()).toEqual([SPLASH_TIMING.fadeIn, SPLASH_TIMING.hold, SPLASH_TIMING.fadeOut]);
  });

  test("タップを待たない間は、画面がクリックを遮らない", async () => {
    const s = setup({ mobile: false });
    await flush();
    expect(s.overlay().classList.contains("splash-waiting")).toBe(false);
    await s.waiter.advance();
    await s.waiter.advance();
    await s.waiter.advance();
  });
});

describe("モバイルでの起動（タップを待つ）", () => {
  test("バナーの後に文言を出し、タップされるまで進まない", async () => {
    const s = setup({ mobile: true });
    await flush();
    await s.waiter.advance(); // バナーのフェードイン

    // 文言がフェードインし、タップを受け付ける状態になる
    expect(s.tap().classList.contains("splash-visible")).toBe(true);
    expect(s.tap().textContent).toBe("[splash.tap]");
    expect(s.overlay().classList.contains("splash-waiting")).toBe(true);
    // 表示時間の待ちは使わず、タップを待つ
    expect(s.waiter.pending()).toEqual([]);
    expect(s.unlocked.length).toBe(0);

    // タップで音を解放し、バナーと文言をまとめてフェードアウトする
    s.overlay().fire("pointerdown");
    await flush();
    expect(s.unlocked.length).toBe(1);
    expect(s.banner().classList.contains("splash-visible")).toBe(false);
    expect(s.tap().classList.contains("splash-visible")).toBe(false);
    expect(s.overlay().classList.contains("splash-waiting")).toBe(false);
    expect(s.waiter.pending()).toEqual([SPLASH_TIMING.fadeOut]);
    await s.waiter.advance();

    expect(s.overlay()).toBeNull();
    await expect(s.promise).resolves.toEqual({ done: true, tapped: true });
  });

  test("二度タップしても音の解放は一度だけ", async () => {
    const s = setup({ mobile: true });
    await flush();
    await s.waiter.advance();
    s.overlay().fire("pointerdown");
    s.overlay().fire("pointerdown");
    await flush();
    expect(s.unlocked.length).toBe(1);
    expect(s.waiter.pending()).toEqual([SPLASH_TIMING.fadeOut]);
  });

  test("文言が出る前のタップは無視する", async () => {
    const s = setup({ mobile: true });
    await flush();
    s.overlay().fire("pointerdown");
    await flush();
    expect(s.unlocked.length).toBe(0);
    expect(s.waiter.pending()).toEqual([SPLASH_TIMING.fadeIn]);
  });
});

describe("途中で止める", () => {
  test("停止すると画面を即座に片付け、done: false で終わる", async () => {
    const s = setup({ mobile: false });
    await flush();
    cancelSplash();
    await flush();
    expect(s.overlay()).toBeNull();
    await expect(s.promise).resolves.toEqual({ done: false, tapped: false });
  });

  test("タップ待ちの最中に止めても、音の解放は呼ばれない", async () => {
    const s = setup({ mobile: true });
    await flush();
    await s.waiter.advance();
    cancelSplash();
    await flush();
    expect(s.overlay()).toBeNull();
    expect(s.unlocked.length).toBe(0);
    await expect(s.promise).resolves.toEqual({ done: false, tapped: false });
  });

  test("止めた後に残っていた待ちが明けても、何も起きない", async () => {
    const s = setup({ mobile: false });
    await flush();
    cancelSplash();
    await flush();
    await s.waiter.advance(); // 止める前に始まっていたフェードインの待ち
    expect(s.container.children.length).toBe(0);
    expect(s.waiter.history()).toEqual([SPLASH_TIMING.fadeIn]);
  });

  test("表示中にもう一度始めると、前の画面は片付けて新しい画面だけになる", async () => {
    const first = setup({ mobile: false });
    await flush();
    const second = runSplash(first.container, {
      mobile: false,
      wait: first.waiter.wait,
      unlock: () => Promise.resolve(true),
      t: (k) => k,
    });
    await flush();
    await expect(first.promise).resolves.toEqual({ done: false, tapped: false });
    expect(first.container.children.length).toBe(1);
    cancelSplash();
    await expect(second).resolves.toEqual({ done: false, tapped: false });
  });

  test("何も表示していない時に止めても例外にならない", () => {
    expect(() => cancelSplash()).not.toThrow();
  });
});

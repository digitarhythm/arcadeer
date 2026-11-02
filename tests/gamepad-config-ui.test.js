// キーコンフィグ画面（web/gamepad-config-ui.js）のテスト
//
// 画面の組み立てと進行を、最小限の偽の DOM で確かめる。
// 実際の描画は見ないが、「同じ画面を二重に作らない」「表示の途中で例外を出さない」
// といった、文言が空のまま出てしまう原因になる振る舞いを押さえる。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/** 偽の要素。知らないメソッドは何もしない関数として振る舞う */
function stubElement(name) {
  const listeners = new Map();
  const children = new Map();
  const base = {
    name,
    textContent: "",
    hidden: false,
    open: false,
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    /** テストから、登録された聞き手を呼ぶ */
    fire(type) {
      for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {} });
    },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, stubElement(selector));
      return children.get(selector);
    },
    querySelectorAll: () => [],
    getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }),
    showModal() {
      base.open = true;
    },
    close() {
      base.open = false;
    },
  };
  return new Proxy(base, {
    get: (target, key) => {
      if (key in target) return target[key];
      // then まで関数にすると Promise が thenable と見なして待ち続けてしまう
      if (key === "then" || typeof key === "symbol") return undefined;
      return () => undefined;
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
}

/** body へ追加された要素（= 作られた画面） */
const appended = [];
const byId = new Map();

/** 書き換える前のグローバル（ほかのテストファイルへ漏らさないために戻す） */
const saved = {};
const GLOBALS = ["window", "location", "localStorage", "document", "fetch"];

beforeAll(() => {
  for (const name of GLOBALS) saved[name] = globalThis[name];
  saved.getGamepads = globalThis.navigator.getGamepads;
  globalThis.window = globalThis;
  globalThis.location = { href: "http://localhost/test/" };
  globalThis.localStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };
  globalThis.document = {
    createElement: (tag) => stubElement(tag),
    createElementNS: (_ns, tag) => stubElement(tag),
    body: { appendChild: (el) => appended.push(el) },
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, stubElement(id));
      return byId.get(id);
    },
  };
  // コントローラーの絵は読み込まずに済ませる
  globalThis.fetch = async () => ({ text: async () => "<svg></svg>" });
  // つながっているパッドを1台にする（何も押していない）
  globalThis.navigator.getGamepads = () => [
    { id: "Test Pad (Vendor: 1234 Product: 5678)", axes: [0, 0, 0, 0], buttons: [] },
  ];
});

afterAll(() => {
  for (const name of GLOBALS) {
    if (saved[name] === undefined) delete globalThis[name];
    else globalThis[name] = saved[name];
  }
  if (saved.getGamepads === undefined) delete globalThis.navigator.getGamepads;
  else globalThis.navigator.getGamepads = saved.getGamepads;
});

describe("矢印の形", () => {
  test("半径から、外側へ向かう矢印のパスを作る", async () => {
    const { arrowPath } = await import("../web/gamepad-config-ui.js");
    // 始点は半径+2。そこから右へ 10 伸ばし、先端に 4 の返しを付ける
    expect(arrowPath(12)).toBe("M 14 0 L 24 0 M 20 -4 L 24 0 L 20 4");
  });

  test("テンプレート文字列の中に、定義されていない全角の識別子を使っていない", () => {
    // `${始点}` のように、宣言は ASCII に直したのに使う側が残ると ReferenceError になる
    const source = readFileSync(new URL("../web/gamepad-config-ui.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/\$\{[^}]*[^\x00-\x7F][^}]*\}/);
  });
});

describe("画面の組み立て", () => {
  test("同時に2回呼んでも、画面は1つしか作らない", async () => {
    const { ensureDialog } = await import("../web/gamepad-config-ui.js");
    const before = appended.length;
    // 絵の読み込みを待っている間に、もう一度呼ばれる状況
    const [a, b] = await Promise.all([ensureDialog(), ensureDialog()]);
    expect(a).toBe(b);
    expect(appended.length - before).toBe(1);
  });
});

describe("キーコンフィグを開く", () => {
  test("開いている最中にもう一度呼ぶと null を返し、最初の画面はそのまま進む", async () => {
    const { openGamePadConfig } = await import("../web/gamepad-config-ui.js");
    const before = appended.length;
    const first = openGamePadConfig();
    const second = openGamePadConfig();
    expect(await second).toBeNull();
    expect(appended.length - before).toBe(0);

    // 最初の手順の表示が終わっていること（文言が入り、画面が開いている）。
    // 文言は document 全体ではなく、作った画面の中へ入れる
    const dialog = appended[0];
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("#padconf-title").textContent).not.toBe("");
    expect(dialog.querySelector("#padconf-skip").textContent).not.toBe("");
    expect(byId.size).toBe(0);

    // 「やめる」で片付ける（例外が出ていれば、ここで reject になる）
    dialog.querySelector("#padconf-cancel").fire("click");
    expect(await first).toBeNull();
  });

  test("片付けたあとは、もう一度開ける", async () => {
    const { openGamePadConfig } = await import("../web/gamepad-config-ui.js");
    const again = openGamePadConfig();
    await new Promise((r) => setTimeout(r, 20));
    appended[0].querySelector("#padconf-cancel").fire("click");
    expect(await again).toBeNull();
  });
});

// ゲーム画面の配置設定のテスト（仕様書4.13節）
//
// システム設定ダイアログのラジオボタンで、ゲーム実行画面を
// 「エディタの上に重ねる」か「エディタの右に並べる」かを選べる。
// ウィンドウの縦横比では切り替えない。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  SUPPORTED_GAME_LAYOUTS,
  DEFAULT_GAME_LAYOUT,
  GAME_LAYOUT_CLASSES,
  normalizeGameLayout,
  resolveGameLayout,
  bodyClassFor,
} from "../web/game-layout.js";
import { SECTIONS } from "../web/reference/structure.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("配置の定義", () => {
  test("「エディタの上」と「エディタの右」の2つを、この順で選べる", () => {
    // ダイアログのラジオボタンもこの順に並ぶ（既定を先に置く）
    expect(SUPPORTED_GAME_LAYOUTS).toEqual(["overlay", "side"]);
  });

  test("既定は「エディタの上」", () => {
    expect(DEFAULT_GAME_LAYOUT).toBe("overlay");
  });

  test("body に付けるクラスは配置ごとに1つずつある", () => {
    expect(GAME_LAYOUT_CLASSES).toEqual(["game-layout-overlay", "game-layout-side"]);
  });
});

describe("値の整え方", () => {
  test("対応する値はそのまま通る", () => {
    expect(normalizeGameLayout("overlay")).toBe("overlay");
    expect(normalizeGameLayout("side")).toBe("side");
  });

  test("前後の空白と大文字小文字は吸収する（保存値は文字列で戻るため）", () => {
    expect(normalizeGameLayout(" Side ")).toBe("side");
    expect(normalizeGameLayout("OVERLAY")).toBe("overlay");
  });

  test("対応しない値は受け取らない", () => {
    expect(normalizeGameLayout("top")).toBeNull();
    expect(normalizeGameLayout("right")).toBeNull();
    expect(normalizeGameLayout("")).toBeNull();
    expect(normalizeGameLayout(null)).toBeNull();
    expect(normalizeGameLayout(undefined)).toBeNull();
    expect(normalizeGameLayout(1)).toBeNull();
    expect(normalizeGameLayout({})).toBeNull();
  });
});

describe("保存値からの決定", () => {
  test("正しい値はそのまま使う", () => {
    expect(resolveGameLayout("side")).toBe("side");
    expect(resolveGameLayout("overlay")).toBe("overlay");
  });

  test("未保存や読めない値は既定（エディタの上）へ戻す", () => {
    expect(resolveGameLayout(null)).toBe(DEFAULT_GAME_LAYOUT);
    expect(resolveGameLayout("")).toBe(DEFAULT_GAME_LAYOUT);
    expect(resolveGameLayout("みぎ")).toBe(DEFAULT_GAME_LAYOUT);
  });
});

describe("body へ付けるクラス", () => {
  test("配置ごとのクラス名を返す", () => {
    expect(bodyClassFor("overlay")).toBe("game-layout-overlay");
    expect(bodyClassFor("side")).toBe("game-layout-side");
  });

  test("読めない値でも既定の配置のクラスになる", () => {
    expect(bodyClassFor("みぎ")).toBe(bodyClassFor(DEFAULT_GAME_LAYOUT));
  });

  test("返すクラスは必ず一覧の中にある（切り替え時に古い方を外せるように）", () => {
    for (const layout of SUPPORTED_GAME_LAYOUTS) {
      expect(GAME_LAYOUT_CLASSES).toContain(bodyClassFor(layout));
    }
  });
});

describe("画面側の構成", () => {
  const css = read("../web/style.css");
  const html = read("../web/index.html");

  test("配置はウィンドウの縦横比では切り替えない", () => {
    // 以前は @media (min-aspect-ratio: 16 / 9) で分けていた
    // （サムネイルを正方形にする aspect-ratio プロパティは対象外）
    expect(css).not.toMatch(/@media[^{]*aspect-ratio/);
  });

  test("配置は body のクラスで切り替える", () => {
    expect(css).toContain("body.game-layout-side");
    expect(css).toContain("body.game-layout-overlay");
  });

  test("ゲーム表示エリアの最上部のボタンエリアは無くなり、実行トグルは左ペインだけに置く", () => {
    expect(html).not.toContain("ide-game-header");
    expect(html).not.toContain('id="btn-toggle-game"');
    expect(css).not.toContain(".ide-game-header");
  });

  test("Service Worker が配置モジュールをキャッシュする", () => {
    const sw = read("../web/service-worker.js");
    expect(sw).toContain('"./game-layout.js"');
  });
});

describe("文言", () => {
  const locale = JSON.parse(read("../web/locales/ja.json"));

  test("設定ダイアログの見出しと選択肢の文言がある", () => {
    expect(locale["settings.gameLayout"]).toBe("ゲーム画面の配置");
    expect(locale["gameLayout.overlay"]).toBe("エディタの上に重ねる");
    expect(locale["gameLayout.side"]).toBe("エディタの右に並べる");
  });

  test("IDEリファレンスの「IDEの使い方」に配置の説明がある", () => {
    const ide = SECTIONS.find((s) => s.id === "ide");
    const keys = ide.blocks.map((b) => b.k);
    expect(keys).toContain("ref.ide.h.layout");
    expect(keys).toContain("ref.ide.d.layout");
  });
});

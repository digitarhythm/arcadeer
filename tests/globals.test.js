// ゲーム全体で共有する連想配列 GLOBAL のテスト
import { beforeEach, describe, expect, test } from "bun:test";

import { GLOBAL, clearGlobals, globalKeys } from "../web/globals.js";

beforeEach(() => clearGlobals());

describe("値の出し入れ", () => {
  test("最初は空", () => {
    expect(globalKeys()).toEqual([]);
  });

  test("ドットで読み書きできる", () => {
    GLOBAL.SCORE = 100;
    expect(GLOBAL.SCORE).toBe(100);
  });

  test("キー名の文字列でも読み書きできる", () => {
    GLOBAL["LIVES"] = 3;
    expect(GLOBAL["LIVES"]).toBe(3);
    expect(GLOBAL.LIVES).toBe(3);
  });

  test("入れていないキーは undefined になる", () => {
    expect(GLOBAL.MISSING).toBeUndefined();
  });

  test("数値以外も入れられる", () => {
    GLOBAL.NAME = "ねこ";
    GLOBAL.ITEMS = ["剣", "盾"];
    GLOBAL.FLAGS = { cleared: true };
    expect(GLOBAL.NAME).toBe("ねこ");
    expect(GLOBAL.ITEMS[1]).toBe("盾");
    expect(GLOBAL.FLAGS.cleared).toBe(true);
  });

  test("キーを消せる", () => {
    GLOBAL.TEMP = 1;
    delete GLOBAL.TEMP;
    expect(GLOBAL.TEMP).toBeUndefined();
  });

  test("入っているキーを一覧できる", () => {
    GLOBAL.A = 1;
    GLOBAL.B = 2;
    expect(globalKeys().sort()).toEqual(["A", "B"]);
  });
});

describe("共有のされ方", () => {
  test("読み込み直しても同じ実体を指す", async () => {
    GLOBAL.SCORE = 42;
    const again = await import("../web/globals.js");
    // 別のクラスファイルから参照しても同じものが見える
    expect(again.GLOBAL).toBe(GLOBAL);
    expect(again.GLOBAL.SCORE).toBe(42);
  });
});

describe("実行のたびの初期化", () => {
  test("中身を空にできる", () => {
    GLOBAL.SCORE = 100;
    GLOBAL.LIVES = 3;
    clearGlobals();
    expect(globalKeys()).toEqual([]);
    expect(GLOBAL.SCORE).toBeUndefined();
  });

  test("空にしても実体は入れ替えない", () => {
    // 入れ替えると、既に受け取っている側が古いものを見続けてしまう
    const before = GLOBAL;
    GLOBAL.SCORE = 1;
    clearGlobals();
    expect(GLOBAL).toBe(before);
  });

  test("空にしたあとも使える", () => {
    clearGlobals();
    GLOBAL.SCORE = 7;
    expect(GLOBAL.SCORE).toBe(7);
  });
});

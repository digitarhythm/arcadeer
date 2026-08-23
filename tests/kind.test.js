// オブジェクト種別（@KIND）の解釈と自動判定のテスト
import { beforeEach, describe, expect, test } from "bun:test";

import {
  KIND_NONE,
  KIND_PRIMITIVE,
  KIND_2D,
  KIND_3D,
  KIND_NAMES,
  normalizeKind,
  inferKind,
  resolveKind,
  resetKindWarnings,
} from "../web/kind.js";
import { clearLogs, logLines } from "../web/console-log.js";

beforeEach(() => {
  resetKindWarnings();
  clearLogs();
});

describe("番号の割り当て", () => {
  test("管理用が0、プリミティブが1、2Dが2、3Dが3", () => {
    expect(KIND_NONE).toBe(0);
    expect(KIND_PRIMITIVE).toBe(1);
    expect(KIND_2D).toBe(2);
    expect(KIND_3D).toBe(3);
  });

  test("使える名前は4つ", () => {
    expect(KIND_NAMES).toEqual(["NONE", "PRIM", "2D", "3D"]);
  });
});

describe("名前と数値の解釈", () => {
  test("名前で指定できる", () => {
    expect(normalizeKind("NONE")).toBe(KIND_NONE);
    expect(normalizeKind("PRIM")).toBe(KIND_PRIMITIVE);
    expect(normalizeKind("2D")).toBe(KIND_2D);
    expect(normalizeKind("3D")).toBe(KIND_3D);
  });

  test("大文字小文字は区別しない", () => {
    expect(normalizeKind("none")).toBe(KIND_NONE);
    expect(normalizeKind("prim")).toBe(KIND_PRIMITIVE);
    expect(normalizeKind("3d")).toBe(KIND_3D);
  });

  test("前後の空白は無視する", () => {
    expect(normalizeKind("  3D ")).toBe(KIND_3D);
  });

  test("数値でも指定できる", () => {
    expect(normalizeKind(0)).toBe(KIND_NONE);
    expect(normalizeKind(1)).toBe(KIND_PRIMITIVE);
    expect(normalizeKind(2)).toBe(KIND_2D);
    expect(normalizeKind(3)).toBe(KIND_3D);
  });

  test("指定が無ければ null を返す", () => {
    expect(normalizeKind(undefined)).toBeNull();
    expect(normalizeKind(null)).toBeNull();
    expect(normalizeKind("")).toBeNull();
  });

  test("知らない値は null を返す", () => {
    expect(normalizeKind("2.5D")).toBeNull();
    expect(normalizeKind(7)).toBeNull();
    expect(normalizeKind(4)).toBeNull();
    expect(normalizeKind(-1)).toBeNull();
    expect(normalizeKind({})).toBeNull();
  });
});

describe("MODELからの自動判定", () => {
  test("組み込み形状名はプリミティブ", () => {
    expect(inferKind("box")).toBe(KIND_PRIMITIVE);
    expect(inferKind("SPHERE")).toBe(KIND_PRIMITIVE);
  });

  test("3Dモデルの拡張子は3D", () => {
    expect(inferKind("default-cat.glb")).toBe(KIND_3D);
    expect(inferKind("scene.gltf")).toBe(KIND_3D);
    expect(inferKind("SCENE.GLB")).toBe(KIND_3D);
  });

  test("画像の拡張子は2D", () => {
    for (const name of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.bmp"]) {
      expect(inferKind(name)).toBe(KIND_2D);
    }
  });

  test("判断できない値は null を返す", () => {
    expect(inferKind("torus")).toBeNull();
    expect(inferKind("a.mp3")).toBeNull();
    expect(inferKind("")).toBeNull();
    expect(inferKind(undefined)).toBeNull();
  });
});

describe("種別の決定", () => {
  test("指定があればそれに従う", () => {
    expect(resolveKind({ KIND: "3D", MODEL: "cat.glb" })).toBe(KIND_3D);
    // MODELと食い違っていても、明示した指定を優先する
    expect(resolveKind({ KIND: "PRIM", MODEL: "cat.glb" })).toBe(KIND_PRIMITIVE);
  });

  test("指定が無ければ MODEL から決める", () => {
    expect(resolveKind({ MODEL: "cat.glb" })).toBe(KIND_3D);
    expect(resolveKind({ MODEL: "box" })).toBe(KIND_PRIMITIVE);
    expect(resolveKind({ MODEL: "player.png" })).toBe(KIND_2D);
  });

  test("どちらからも決まらなければ管理用にする", () => {
    // gameMain のように、画面に出さず処理だけを持つオブジェクト
    expect(resolveKind({})).toBe(KIND_NONE);
    expect(resolveKind({ MODEL: "torus" })).toBe(KIND_NONE);
  });

  test("管理用を名前で指定できる", () => {
    expect(resolveKind({ KIND: "NONE" })).toBe(KIND_NONE);
    // MODEL があっても、NONE と書けば描かない
    expect(resolveKind({ KIND: "NONE", MODEL: "cat.glb" })).toBe(KIND_NONE);
  });

  test("空の値でも落ちない", () => {
    expect(resolveKind(null)).toBe(KIND_NONE);
    expect(resolveKind(undefined)).toBe(KIND_NONE);
  });
});

describe("知らない指定の通知", () => {
  test("知らない値はコンソールへ知らせる", () => {
    resolveKind({ KIND: "2.5D", MODEL: "box" });
    expect(logLines().length).toBe(1);
    expect(logLines()[0]).toContain("2.5D");
  });

  test("同じ値は一度しか知らせない（毎フレーム出さない）", () => {
    for (let i = 0; i < 100; i += 1) resolveKind({ KIND: "2.5D" });
    expect(logLines().length).toBe(1);
  });

  test("値が違えばそれぞれ知らせる", () => {
    resolveKind({ KIND: "2.5D" });
    resolveKind({ KIND: 9 });
    expect(logLines().length).toBe(2);
  });

  test("指定していない場合は知らせない（自動判定は正常な使い方）", () => {
    resolveKind({ MODEL: "cat.glb" });
    resolveKind({});
    expect(logLines()).toEqual([]);
  });

  test("正しい指定では知らせない", () => {
    resolveKind({ KIND: "3D" });
    resolveKind({ KIND: "NONE" });
    resolveKind({ KIND: 0 });
    expect(logLines()).toEqual([]);
  });
});

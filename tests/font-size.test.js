// エディタの文字サイズ設定のテスト
import { describe, expect, test } from "bun:test";
import {
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  DEFAULT_FONT_SIZE,
  normalizeFontSize,
  resolveFontSize,
  aceFontSize,
} from "../web/font-size.js";

describe("文字サイズの定義", () => {
  test("1〜255 を指定できる", () => {
    expect([MIN_FONT_SIZE, MAX_FONT_SIZE]).toEqual([1, 255]);
  });

  test("既定は 13", () => {
    // これまで直書きしていた 13px を、そのまま既定にする
    expect(DEFAULT_FONT_SIZE).toBe(13);
  });
});

describe("値の整え方", () => {
  test("範囲の中の値はそのまま通る", () => {
    for (const size of [1, 13, 42, 255]) expect(normalizeFontSize(size)).toBe(size);
  });

  test("文字列でも数として読む（保存値は文字列で戻るため）", () => {
    expect(normalizeFontSize("16")).toBe(16);
    expect(normalizeFontSize(" 18 ")).toBe(18);
  });

  test("範囲の外は端へ寄せる", () => {
    // 壊れた保存値でも、既定へ戻すより意図に近いことが多い
    expect(normalizeFontSize(0)).toBe(1);
    expect(normalizeFontSize(-13)).toBe(1);
    expect(normalizeFontSize(999)).toBe(255);
  });

  test("小数は四捨五入する", () => {
    expect(normalizeFontSize(13.4)).toBe(13);
    expect(normalizeFontSize(13.5)).toBe(14);
  });

  test("数として読めないものは受け取らない", () => {
    expect(normalizeFontSize("おおきく")).toBeNull();
    expect(normalizeFontSize("")).toBeNull();
    expect(normalizeFontSize(null)).toBeNull();
    expect(normalizeFontSize(undefined)).toBeNull();
    expect(normalizeFontSize(NaN)).toBeNull();
    expect(normalizeFontSize(Infinity)).toBeNull();
    expect(normalizeFontSize({})).toBeNull();
  });
});

describe("保存値からの決定", () => {
  test("正しい値はそのまま使う", () => {
    expect(resolveFontSize("20")).toBe(20);
  });

  test("未保存や読めない値は既定へ戻す", () => {
    expect(resolveFontSize(null)).toBe(DEFAULT_FONT_SIZE);
    expect(resolveFontSize("")).toBe(DEFAULT_FONT_SIZE);
    expect(resolveFontSize("おおきく")).toBe(DEFAULT_FONT_SIZE);
  });

  test("範囲の外の保存値は端へ寄せる", () => {
    expect(resolveFontSize("999")).toBe(MAX_FONT_SIZE);
  });
});

describe("Ace へ渡す値", () => {
  test("px を付けた文字列にする", () => {
    expect(aceFontSize(16)).toBe("16px");
  });

  test("読めない値でも既定の大きさになる", () => {
    expect(aceFontSize("おおきく")).toBe(`${DEFAULT_FONT_SIZE}px`);
  });
});

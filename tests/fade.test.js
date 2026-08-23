// ダイアログ外クリック判定のテスト
import { describe, expect, test } from "bun:test";
import { isPointInRect } from "../web/fade.js";

const rect = { left: 100, top: 50, right: 300, bottom: 200 };

describe("ダイアログ内かどうかの判定", () => {
  test("内側の座標は true", () => {
    expect(isPointInRect(rect, 200, 120)).toBe(true);
  });

  test("外側の座標は false", () => {
    expect(isPointInRect(rect, 50, 120)).toBe(false); // 左
    expect(isPointInRect(rect, 350, 120)).toBe(false); // 右
    expect(isPointInRect(rect, 200, 10)).toBe(false); // 上
    expect(isPointInRect(rect, 200, 250)).toBe(false); // 下
  });

  test("境界上は内側として扱う", () => {
    expect(isPointInRect(rect, 100, 50)).toBe(true);
    expect(isPointInRect(rect, 300, 200)).toBe(true);
  });

  test("角の外側は false", () => {
    expect(isPointInRect(rect, 99, 49)).toBe(false);
    expect(isPointInRect(rect, 301, 201)).toBe(false);
  });
});

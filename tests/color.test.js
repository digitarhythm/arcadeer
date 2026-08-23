// 色指定（@COLOR）の解釈テスト
import { describe, expect, test } from "bun:test";

import { WHITE, parseColor, parseColorOrNull } from "../web/color.js";

const near = (a, b, tol = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("色の解釈", () => {
  test("6桁の16進数を読む", () => {
    const c = parseColor("#ff8800");
    near(c[0], 1);
    near(c[1], 0x88 / 255);
    near(c[2], 0);
    near(c[3], 1);
  });

  test("3桁の短縮形を読む", () => {
    // #f80 は #ff8800 と同じ
    expect(parseColor("#f80")).toEqual(parseColor("#ff8800"));
  });

  test("8桁なら不透明度も読む", () => {
    const c = parseColor("#ff880080");
    near(c[3], 0x80 / 255);
  });

  test("先頭の # は省略できる", () => {
    expect(parseColor("ff8800")).toEqual(parseColor("#ff8800"));
  });

  test("大文字小文字は区別しない", () => {
    expect(parseColor("#FF8800")).toEqual(parseColor("#ff8800"));
  });

  test("前後の空白は無視する", () => {
    expect(parseColor("  #ff8800 ")).toEqual(parseColor("#ff8800"));
  });

  test("指定が無ければ白にする", () => {
    expect(parseColor(undefined)).toEqual(WHITE);
    expect(parseColor(null)).toEqual(WHITE);
    expect(parseColor("")).toEqual(WHITE);
  });

  test("読めない値は白にする（描画は止めない）", () => {
    expect(parseColor("赤")).toEqual(WHITE);
    expect(parseColor("#ggg")).toEqual(WHITE);
    expect(parseColor("#ff88")).toEqual(WHITE);
    expect(parseColor(123)).toEqual(WHITE);
  });

  test("白は 1,1,1,1", () => {
    expect(WHITE).toEqual([1, 1, 1, 1]);
  });
});

describe("読めたかどうかを区別する", () => {
  test("読めた場合は色を返す", () => {
    expect(parseColorOrNull("#ff8800")).toEqual(parseColor("#ff8800"));
  });

  test("読めない場合は null を返す", () => {
    // 白に落とすと困る場面（環境光など）で使う
    expect(parseColorOrNull("赤")).toBeNull();
    expect(parseColorOrNull("")).toBeNull();
    expect(parseColorOrNull(undefined)).toBeNull();
    expect(parseColorOrNull("#ff88")).toBeNull();
  });

  test("白そのものは null にしない", () => {
    expect(parseColorOrNull("#ffffff")).toEqual([1, 1, 1, 1]);
  });
});

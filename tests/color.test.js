// 色指定（@COLOR）の解釈テスト
import { describe, expect, test } from "bun:test";

import { WHITE, parseColor, parseColorOrNull, normalizeAlpha, objectColor } from "../web/color.js";

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

describe("透明度の正規化（@ALPHA）", () => {
  test("0〜1はそのまま通す", () => {
    expect(normalizeAlpha(0)).toBe(0);
    expect(normalizeAlpha(0.5)).toBe(0.5);
    expect(normalizeAlpha(1)).toBe(1);
  });

  test("範囲の外は端へ寄せる", () => {
    // 書き間違いで描画が壊れないように
    expect(normalizeAlpha(-1)).toBe(0);
    expect(normalizeAlpha(2)).toBe(1);
  });

  test("数値でないものは1にする", () => {
    expect(normalizeAlpha(undefined)).toBe(1);
    expect(normalizeAlpha(null)).toBe(1);
    expect(normalizeAlpha("0.5")).toBe(1);
    expect(normalizeAlpha(NaN)).toBe(1);
  });
});

describe("オブジェクトの色（@COLOR × @ALPHA）", () => {
  test("@COLOR も @ALPHA も無ければ白のまま", () => {
    expect(objectColor({})).toEqual(WHITE);
  });

  test("@ALPHA が透明度になる", () => {
    const c = objectColor({ ALPHA: 0.25 });
    near(c[3], 0.25);
  });

  test("@COLOR の8桁指定と掛け合わせる", () => {
    // #...80 は約0.5。さらに @ALPHA 0.5 で約0.25になる
    const c = objectColor({ COLOR: "#ff880080", ALPHA: 0.5 });
    near(c[0], 1);
    near(c[3], (0x80 / 255) * 0.5);
  });

  test("色そのものは @ALPHA で変わらない", () => {
    const opaque = objectColor({ COLOR: "#ff8800" });
    const clear = objectColor({ COLOR: "#ff8800", ALPHA: 0.3 });
    expect(clear.slice(0, 3)).toEqual(opaque.slice(0, 3));
  });

  test("渡されなくても落ちない", () => {
    expect(objectColor(null)).toEqual(WHITE);
  });
});

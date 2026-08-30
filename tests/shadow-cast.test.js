// 影を落とす側の分け方と、光の通し方のテスト（仕様書6.2.6節）
import { describe, expect, test } from "bun:test";
import { splitCasters, transmittanceOf } from "../web/shadow-cast.js";

describe("影を落とす側を分ける", () => {
  test("不透明と半透明に分ける", () => {
    const wall = { X: 0 };
    const glass = { X: 1, ALPHA: 0.5 };
    expect(splitCasters([wall, glass])).toEqual({ solid: [wall], translucent: [glass] });
  });

  test("@SHADOW = false はどちらにも入れない", () => {
    // 影を落とさないものは、深度にも透過率にも関わらせない
    const list = [{ SHADOW: false }, { SHADOW: false, ALPHA: 0.5 }];
    expect(splitCasters(list)).toEqual({ solid: [], translucent: [] });
  });

  test("@COLOR の8桁指定でも半透明として扱う", () => {
    const glass = { COLOR: "#ff880080" };
    expect(splitCasters([glass]).translucent).toEqual([glass]);
  });

  test("もとの順を保つ", () => {
    // 掛け算で重ねるため順序は結果に影響しないが、比べやすさのため保つ
    const a = { ALPHA: 0.5, tag: "a" };
    const b = { ALPHA: 0.5, tag: "b" };
    expect(splitCasters([a, b]).translucent.map((o) => o.tag)).toEqual(["a", "b"]);
  });

  test("空でも落ちない", () => {
    expect(splitCasters(null)).toEqual({ solid: [], translucent: [] });
  });
});

describe("どれだけ光を通すか", () => {
  test("透明度の裏返しになる", () => {
    // @ALPHA 0.25 のものは、光を0.75だけ通す
    expect(transmittanceOf({ ALPHA: 0.25 })).toBeCloseTo(0.75, 6);
  });

  test("不透明なら通さない", () => {
    expect(transmittanceOf({})).toBe(0);
    expect(transmittanceOf({ ALPHA: 1 })).toBe(0);
  });

  test("完全に透明なら素通し", () => {
    expect(transmittanceOf({ ALPHA: 0 })).toBe(1);
  });

  test("@COLOR の8桁指定と掛け合わせる", () => {
    // 見た目の濃さと影の濃さを合わせる
    const alpha = (0x80 / 255) * 0.5;
    expect(transmittanceOf({ COLOR: "#ff880080", ALPHA: 0.5 })).toBeCloseTo(1 - alpha, 6);
  });

  test("渡されなくても落ちない", () => {
    expect(transmittanceOf(null)).toBe(0);
  });
});

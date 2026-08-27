// 乱数のテスト
import { describe, expect, test } from "bun:test";
import { random } from "../web/random.js";

/** 決まった値を返す、試験用の元 */
const 固定 = (v) => () => v;

describe("random(n)", () => {
  test("0 から n-1 までを返す（n は含まない）", () => {
    expect(random(5, 固定(0))).toBe(0);
    // 1 の直前まで来ても n-1 で止まる
    expect(random(5, 固定(0.9999999))).toBe(4);
  });

  test("n 通りに均等に分かれる", () => {
    // 0〜3 の4通りなので、境目は 0.25 ごと
    expect(random(4, 固定(0.24))).toBe(0);
    expect(random(4, 固定(0.26))).toBe(1);
    expect(random(4, 固定(0.51))).toBe(2);
    expect(random(4, 固定(0.76))).toBe(3);
  });

  test("1 を渡すと必ず 0", () => {
    expect(random(1, 固定(0))).toBe(0);
    expect(random(1, 固定(0.9999999))).toBe(0);
  });

  test("0 を渡すと必ず 0（選ぶものが無い）", () => {
    expect(random(0, 固定(0.9999999))).toBe(0);
  });

  test("小数は切り捨てる", () => {
    // 2.7 なら 2通り（0〜1）
    expect(random(2.7, 固定(0.9999999))).toBe(1);
  });

  test("負の数は 0 として扱う", () => {
    expect(random(-5, 固定(0.9999999))).toBe(0);
  });

  test("数として読めないものは 0 として扱う", () => {
    for (const v of [undefined, null, NaN, Infinity, "みっつ", {}]) {
      expect(random(v, 固定(0.9999999))).toBe(0);
    }
  });

  test("元が範囲の外を返しても、はみ出さない", () => {
    // 1 ちょうどを返す実装もありうるため、上限で止める
    expect(random(5, 固定(1))).toBe(4);
    expect(random(5, 固定(-0.5))).toBe(0);
  });

  test("既定では Math.random を使い、範囲の中の整数を返す", () => {
    for (let i = 0; i < 200; i += 1) {
      const v = random(4);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(3);
    }
  });

  test("十分な回数を試せば、両端も出る", () => {
    const 出た = new Set();
    for (let i = 0; i < 2000; i += 1) 出た.add(random(3));
    expect([...出た].sort()).toEqual([0, 1, 2]);
  });

  test("配列の添字にそのまま使える", () => {
    // よくある使い方。長さを渡せば、必ず範囲の中に収まる
    const 一覧 = ["赤", "青", "黄"];
    for (let i = 0; i < 300; i += 1) {
      expect(一覧[random(一覧.length)]).not.toBeUndefined();
    }
  });
});

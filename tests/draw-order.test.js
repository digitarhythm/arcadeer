// 半透明を正しく描くための並べ替えのテスト
import { describe, expect, test } from "bun:test";
import { isTransparent, splitByAlpha } from "../web/draw-order.js";

/** 見下ろす位置のカメラ */
const camera = { X: 0, Y: 0, Z: 10 };

describe("半透明かどうか", () => {
  test("@ALPHA が1未満なら半透明", () => {
    expect(isTransparent({ ALPHA: 0.5 })).toBe(true);
  });

  test("@COLOR の8桁指定でも半透明になる", () => {
    expect(isTransparent({ COLOR: "#ff880080" })).toBe(true);
  });

  test("どちらも不透明なら半透明ではない", () => {
    expect(isTransparent({})).toBe(false);
    expect(isTransparent({ ALPHA: 1, COLOR: "#ff8800" })).toBe(false);
  });

  test("完全に透明なものも半透明として扱う", () => {
    // 描かないのではなく、ブレンドの側で消えるようにする
    expect(isTransparent({ ALPHA: 0 })).toBe(true);
  });
});

describe("描く順に分ける", () => {
  test("不透明と半透明に分ける", () => {
    const a = { X: 0, Y: 0, Z: 0 };
    const b = { X: 0, Y: 0, Z: 1, ALPHA: 0.5 };
    const { opaque, transparent } = splitByAlpha([a, b], camera);
    expect(opaque).toEqual([a]);
    expect(transparent).toEqual([b]);
  });

  test("不透明はもとの順のまま", () => {
    // 深度テストに任せられるので、並べ替える必要がない
    const list = [{ X: 0, Y: 0, Z: 0 }, { X: 0, Y: 0, Z: 5 }, { X: 0, Y: 0, Z: -5 }];
    expect(splitByAlpha(list, camera).opaque).toEqual(list);
  });

  test("半透明はカメラから遠いものを先に描く", () => {
    const near = { X: 0, Y: 0, Z: 8, ALPHA: 0.5 };
    const far = { X: 0, Y: 0, Z: -8, ALPHA: 0.5 };
    const mid = { X: 0, Y: 0, Z: 0, ALPHA: 0.5 };
    const { transparent } = splitByAlpha([near, mid, far], camera);
    expect(transparent).toEqual([far, mid, near]);
  });

  test("距離は3軸で測る", () => {
    const sideways = { X: 20, Y: 0, Z: 10, ALPHA: 0.5 };
    const front = { X: 0, Y: 0, Z: 0, ALPHA: 0.5 };
    const { transparent } = splitByAlpha([front, sideways], camera);
    expect(transparent).toEqual([sideways, front]);
  });

  test("同じ距離なら、もとの順を保つ", () => {
    const first = { X: 0, Y: 0, Z: 0, ALPHA: 0.5, tag: "first" };
    const second = { X: 0, Y: 0, Z: 0, ALPHA: 0.5, tag: "second" };
    const { transparent } = splitByAlpha([first, second], camera);
    expect(transparent.map((o) => o.tag)).toEqual(["first", "second"]);
  });

  test("カメラが無くても落ちない", () => {
    const list = [{ X: 0, Y: 0, Z: 0, ALPHA: 0.5 }];
    expect(splitByAlpha(list, null).transparent).toEqual(list);
  });

  test("空でも落ちない", () => {
    expect(splitByAlpha(null, camera)).toEqual({ opaque: [], transparent: [] });
  });
});

// 組み込みプリミティブ形状の生成テスト
import { describe, expect, test } from "bun:test";

import {
  PRIMITIVE_NAMES,
  isPrimitiveName,
  buildPrimitive,
} from "../web/primitive.js";

/** 誤差を許して比べる */
const near = (a, b, tol = 1e-5) => expect(Math.abs(a - b)).toBeLessThan(tol);

/** 頂点の座標範囲を求める */
function bounds(positions) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      lo[a] = Math.min(lo[a], positions[i + a]);
      hi[a] = Math.max(hi[a], positions[i + a]);
    }
  }
  return { lo, hi };
}

describe("形状名", () => {
  test("5種類を用意する", () => {
    expect(PRIMITIVE_NAMES).toEqual(["box", "sphere", "plane", "cylinder", "cone"]);
  });

  test("組み込み名かどうかを判定できる", () => {
    expect(isPrimitiveName("box")).toBe(true);
    expect(isPrimitiveName("cone")).toBe(true);
    // 3Dモデルのファイル名は組み込み名ではない
    expect(isPrimitiveName("default-cat.glb")).toBe(false);
    expect(isPrimitiveName("")).toBe(false);
    expect(isPrimitiveName(null)).toBe(false);
    expect(isPrimitiveName(undefined)).toBe(false);
  });

  test("大文字small文字は区別しない", () => {
    expect(isPrimitiveName("Box")).toBe(true);
    expect(isPrimitiveName("SPHERE")).toBe(true);
  });

  test("知らない名前では形状を作らない", () => {
    expect(buildPrimitive("torus")).toBeNull();
    expect(buildPrimitive("")).toBeNull();
  });
});

describe("すべての形状に共通する条件", () => {
  for (const name of PRIMITIVE_NAMES) {
    test(`${name}: 描画に必要な配列がそろう`, () => {
      const p = buildPrimitive(name);
      const vertices = p.positions.length / 3;
      expect(vertices).toBeGreaterThan(0);
      expect(p.normals.length).toBe(vertices * 3);
      expect(p.colors.length).toBe(vertices * 4);
      expect(p.indices.length % 3).toBe(0);
      expect(p.indices.length).toBeGreaterThan(0);
    });

    test(`${name}: 値がすべて有限`, () => {
      const p = buildPrimitive(name);
      for (const v of p.positions) expect(Number.isFinite(v)).toBe(true);
      for (const v of p.normals) expect(Number.isFinite(v)).toBe(true);
    });

    test(`${name}: 面が実在する頂点を指す`, () => {
      const p = buildPrimitive(name);
      const vertices = p.positions.length / 3;
      for (const i of p.indices) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(vertices);
      }
    });

    test(`${name}: 法線の長さは1`, () => {
      const p = buildPrimitive(name);
      for (let i = 0; i < p.normals.length; i += 3) {
        near(Math.hypot(p.normals[i], p.normals[i + 1], p.normals[i + 2]), 1, 1e-4);
      }
    });

    test(`${name}: 既定の色は白`, () => {
      const p = buildPrimitive(name);
      for (const v of p.colors) expect(v).toBe(1);
    });

    test(`${name}: 原点を中心に、1辺（直径）1に収まる`, () => {
      // SCALEX/Y/Z で伸ばして使えるよう、大きさをそろえる
      const { lo, hi } = bounds(buildPrimitive(name).positions);
      for (let a = 0; a < 3; a += 1) {
        expect(lo[a]).toBeGreaterThanOrEqual(-0.5 - 1e-6);
        expect(hi[a]).toBeLessThanOrEqual(0.5 + 1e-6);
        // 中心が原点にある
        near((lo[a] + hi[a]) / 2, 0, 1e-6);
      }
    });
  }
});

describe("形状ごとの大きさ", () => {
  test("box は 1×1×1", () => {
    const { lo, hi } = bounds(buildPrimitive("box").positions);
    for (let a = 0; a < 3; a += 1) near(hi[a] - lo[a], 1);
  });

  test("sphere は直径1", () => {
    const { lo, hi } = bounds(buildPrimitive("sphere").positions);
    for (let a = 0; a < 3; a += 1) near(hi[a] - lo[a], 1, 1e-3);
  });

  test("sphere の頂点はすべて半径0.5", () => {
    const p = buildPrimitive("sphere");
    for (let i = 0; i < p.positions.length; i += 3) {
      near(Math.hypot(p.positions[i], p.positions[i + 1], p.positions[i + 2]), 0.5, 1e-4);
    }
  });

  test("plane は XY平面に立つ板（厚みなし）", () => {
    const { lo, hi } = bounds(buildPrimitive("plane").positions);
    near(hi[0] - lo[0], 1);
    near(hi[1] - lo[1], 1);
    near(hi[2] - lo[2], 0);
  });

  test("plane の法線はすべて手前（+Z）を向く", () => {
    const p = buildPrimitive("plane");
    for (let i = 0; i < p.normals.length; i += 3) {
      near(p.normals[i + 2], 1);
    }
  });

  test("cylinder は直径1・高さ1", () => {
    const { lo, hi } = bounds(buildPrimitive("cylinder").positions);
    near(hi[0] - lo[0], 1, 1e-3);
    near(hi[1] - lo[1], 1);
    near(hi[2] - lo[2], 1, 1e-3);
  });

  test("cone は底面が直径1で、頂点が真上にある", () => {
    const p = buildPrimitive("cone");
    const { lo, hi } = bounds(p.positions);
    near(hi[0] - lo[0], 1, 1e-3);
    near(hi[1] - lo[1], 1);
    // 最も高い点は中心軸上にある
    let top = -Infinity;
    let topX = 0;
    let topZ = 0;
    for (let i = 0; i < p.positions.length; i += 3) {
      if (p.positions[i + 1] > top) {
        top = p.positions[i + 1];
        topX = p.positions[i];
        topZ = p.positions[i + 2];
      }
    }
    near(topX, 0, 1e-6);
    near(topZ, 0, 1e-6);
  });
});

describe("作り直しても同じ結果になる", () => {
  test("呼ぶたびに新しい配列を返す（書き換えても影響しない）", () => {
    const a = buildPrimitive("box");
    const b = buildPrimitive("box");
    expect(a.positions).not.toBe(b.positions);
    a.positions[0] = 999;
    expect(b.positions[0]).not.toBe(999);
  });
});

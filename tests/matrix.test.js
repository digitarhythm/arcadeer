// 4x4行列（列優先）のテスト
import { describe, expect, test } from "bun:test";
import {
  identity,
  multiply,
  translation,
  scaling,
  rotationY,
  perspective,
  lookAt,
  transformPoint,
  orthographic,
  lightViewProjection,
} from "../web/matrix.js";

/** 誤差を許して比べる */
function close(actual, expected, tolerance = 1e-6) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThan(tolerance);
  }
}

describe("基本の行列", () => {
  test("単位行列は対角が1", () => {
    close(identity(), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  test("単位行列を掛けても変わらない", () => {
    const m = translation(1, 2, 3);
    close(multiply(identity(), m), m);
    close(multiply(m, identity()), m);
  });

  test("平行移動は点をずらす", () => {
    close(transformPoint(translation(10, 20, 30), [1, 2, 3]), [11, 22, 33]);
  });

  test("拡大縮小は点を伸ばす", () => {
    close(transformPoint(scaling(2, 3, 4), [1, 1, 1]), [2, 3, 4]);
  });

  test("Y軸90度の回転でX軸がZ軸へ向く", () => {
    const m = rotationY(Math.PI / 2);
    close(transformPoint(m, [1, 0, 0]), [0, 0, -1], 1e-6);
  });

  test("Y軸回転を2回で180度になる", () => {
    const q = rotationY(Math.PI / 2);
    close(transformPoint(multiply(q, q), [1, 0, 0]), [-1, 0, 0], 1e-6);
  });
});

describe("行列の合成順序", () => {
  test("先に拡大してから移動する", () => {
    // multiply(a, b) は「a のあとに b を適用」
    const m = multiply(translation(10, 0, 0), scaling(2, 2, 2));
    close(transformPoint(m, [1, 0, 0]), [12, 0, 0]);
  });

  test("先に移動してから拡大する", () => {
    const m = multiply(scaling(2, 2, 2), translation(10, 0, 0));
    close(transformPoint(m, [1, 0, 0]), [22, 0, 0]);
  });
});

describe("カメラ行列", () => {
  test("注視行列は視点を原点へ移す", () => {
    const view = lookAt([0, 0, 10], [0, 0, 0], [0, 1, 0]);
    close(transformPoint(view, [0, 0, 10]), [0, 0, 0], 1e-6);
  });

  test("注視行列は奥行きを負のZへ置く", () => {
    const view = lookAt([0, 0, 10], [0, 0, 0], [0, 1, 0]);
    // 注視点はカメラの前方（-Z）にある
    const p = transformPoint(view, [0, 0, 0]);
    expect(p[2]).toBeLessThan(0);
  });

  test("透視投影は近くのものを大きくする", () => {
    const proj = perspective(Math.PI / 4, 1, 0.1, 100);
    const near = transformPoint(proj, [1, 0, -2]);
    const far = transformPoint(proj, [1, 0, -20]);
    expect(Math.abs(near[0])).toBeGreaterThan(Math.abs(far[0]));
  });

  test("透視投影は縦横比を反映する", () => {
    const square = perspective(Math.PI / 4, 1, 0.1, 100);
    const wide = perspective(Math.PI / 4, 2, 0.1, 100);
    // 横長ほど、同じ点のX方向の広がりは小さくなる
    expect(wide[0]).toBeLessThan(square[0]);
  });
});

describe("正射影行列", () => {
  const near = (a, b, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

  test("範囲の中心が原点へ来る", () => {
    const m = orthographic(-2, 2, -2, 2, 1, 11);
    const p = transformPoint(m, [0, 0, -6]);
    near(p[0], 0);
    near(p[1], 0);
    near(p[2], 0);
  });

  test("範囲の端が -1 と 1 になる", () => {
    const m = orthographic(-2, 2, -3, 3, 1, 11);
    near(transformPoint(m, [-2, 0, -6])[0], -1);
    near(transformPoint(m, [2, 0, -6])[0], 1);
    near(transformPoint(m, [0, -3, -6])[1], -1);
    near(transformPoint(m, [0, 3, -6])[1], 1);
  });

  test("手前が -1、奥が 1 になる", () => {
    const m = orthographic(-1, 1, -1, 1, 1, 11);
    near(transformPoint(m, [0, 0, -1])[2], -1);
    near(transformPoint(m, [0, 0, -11])[2], 1);
  });

  test("遠近感が付かない（奥でも大きさが変わらない）", () => {
    const m = orthographic(-5, 5, -5, 5, 1, 100);
    near(transformPoint(m, [5, 0, -2])[0], transformPoint(m, [5, 0, -50])[0]);
  });
});

describe("影のための行列", () => {
  const near = (a, b, tol = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(tol);

  test("光から見た範囲の中心が原点へ来る", () => {
    // 真上から見下ろす光。原点を中心に半径5を写す
    const m = lightViewProjection({ X: 0, Y: 10, Z: 0, targetX: 0, targetY: 0, targetZ: 0 }, 5, 0.1, 50);
    const p = transformPoint(m, [0, 0, 0]);
    near(p[0], 0);
    near(p[1], 0);
  });

  test("範囲の内側は -1〜1 に収まる", () => {
    const m = lightViewProjection({ X: 0, Y: 10, Z: 0, targetX: 0, targetY: 0, targetZ: 0 }, 5, 0.1, 50);
    for (const point of [[4, 0, 4], [-4, 0, -4], [0, 0, 4], [4, 0, 0]]) {
      const p = transformPoint(m, point);
      expect(Math.abs(p[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(p[1])).toBeLessThanOrEqual(1);
      expect(Math.abs(p[2])).toBeLessThanOrEqual(1);
    }
  });

  test("範囲の外側は -1〜1 に収まらない", () => {
    const m = lightViewProjection({ X: 0, Y: 10, Z: 0, targetX: 0, targetY: 0, targetZ: 0 }, 5, 0.1, 50);
    expect(Math.abs(transformPoint(m, [9, 0, 0])[0])).toBeGreaterThan(1);
  });

  test("光に近いほど手前（小さい値）になる", () => {
    const m = lightViewProjection({ X: 0, Y: 10, Z: 0, targetX: 0, targetY: 0, targetZ: 0 }, 5, 0.1, 50);
    // Y が高いほど光に近い
    const 高い = transformPoint(m, [0, 3, 0])[2];
    const 低い = transformPoint(m, [0, 0, 0])[2];
    expect(高い).toBeLessThan(低い);
  });

  test("斜めからの光でも値が壊れない", () => {
    const m = lightViewProjection({ X: 4, Y: 10, Z: 6, targetX: 0, targetY: 0, targetZ: 0 }, 8, 0.1, 60);
    for (const v of transformPoint(m, [1, 1, 1])) expect(Number.isFinite(v)).toBe(true);
  });
});

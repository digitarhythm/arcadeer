// デバッグ表示（当たり判定の枠）のテスト
import { beforeEach, describe, expect, test } from "bun:test";

import {
  setDebug,
  debugOption,
  boundaryLines,
  DEBUG_COLOR,
  DEFAULT_OPACITY,
} from "../web/debug-draw.js";
import { KIND_2D, KIND_3D, KIND_PRIMITIVE } from "../web/kind.js";

/** 直方体の判定 */
const 箱 = (X = 0, Y = 0, Z = 0, hw = 1, hh = 2, hd = 3) => ({
  shape: "box", X, Y, Z, hw, hh, hd, r: 1,
});
/** 球の判定 */
const 球 = (X = 0, Y = 0, Z = 0, r = 2) => ({
  shape: "sphere", X, Y, Z, hw: r, hh: r, hd: r, r,
});

/** 線の並びを、始点と終点の組へ戻す */
function 線分(list) {
  const out = [];
  for (let i = 0; i + 5 < list.length; i += 6) {
    out.push([[list[i], list[i + 1], list[i + 2]], [list[i + 3], list[i + 4], list[i + 5]]]);
  }
  return out;
}

beforeEach(() => setDebug({ debug: false, opacity: DEFAULT_OPACITY }));

describe("デバッグ表示の設定", () => {
  test("既定は切で、濃さは 0.5", () => {
    expect(debugOption()).toEqual({ debug: false, opacity: 0.5 });
    expect(DEFAULT_OPACITY).toBe(0.5);
  });

  test("入にできる", () => {
    setDebug({ debug: true });
    expect(debugOption().debug).toBe(true);
    setDebug({ debug: false });
    expect(debugOption().debug).toBe(false);
  });

  test("濃さを変えられる", () => {
    setDebug({ debug: true, opacity: 0.3 });
    expect(debugOption()).toEqual({ debug: true, opacity: 0.3 });
  });

  test("書いた項目だけ変わる", () => {
    setDebug({ debug: true, opacity: 0.2 });
    setDebug({ opacity: 0.8 });
    expect(debugOption()).toEqual({ debug: true, opacity: 0.8 });
  });

  test("真偽値でない debug は無視する", () => {
    setDebug({ debug: true });
    setDebug({ debug: "はい" });
    expect(debugOption().debug).toBe(true);
  });

  test("扱えない濃さは既定へ戻す", () => {
    // 0 だと見えず、1 を超えると意味を成さない
    setDebug({ opacity: -1 });
    expect(debugOption().opacity).toBe(0.5);
    setDebug({ opacity: 2 });
    expect(debugOption().opacity).toBe(0.5);
    setDebug({ opacity: "うすく" });
    expect(debugOption().opacity).toBe(0.5);
  });

  test("濃さは 1 まで指定できる", () => {
    setDebug({ opacity: 1 });
    expect(debugOption().opacity).toBe(1);
  });

  test("真偽値だけを渡す短い書き方もできる", () => {
    setDebug(true);
    expect(debugOption().debug).toBe(true);
    setDebug(false);
    expect(debugOption().debug).toBe(false);
  });

  test("引数を省略すると入になる", () => {
    setDebug();
    expect(debugOption().debug).toBe(true);
  });

  test("いまの設定を読める（写しが返る）", () => {
    setDebug({ debug: true });
    const 設定 = debugOption();
    設定.debug = false;
    expect(debugOption().debug).toBe(true);
  });

  test("色は赤", () => {
    expect(DEBUG_COLOR).toEqual([1, 0.231, 0.188]);
  });
});

describe("直方体の枠", () => {
  test("12本の辺になる", () => {
    const 線 = boundaryLines(箱(), KIND_3D);
    expect(線.length).toBe(12 * 2 * 3);
    expect(線分(線).length).toBe(12);
  });

  test("大きさと位置が反映される", () => {
    const 線 = boundaryLines(箱(10, 20, 30, 1, 2, 3), KIND_3D);
    const xs = [];
    const ys = [];
    const zs = [];
    for (let i = 0; i + 2 < 線.length; i += 3) {
      xs.push(線[i]); ys.push(線[i + 1]); zs.push(線[i + 2]);
    }
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([9, 11]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([18, 22]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([27, 33]);
  });

  test("プリミティブも直方体で描く", () => {
    expect(boundaryLines(箱(), KIND_PRIMITIVE).length).toBe(12 * 2 * 3);
  });

  test("辺はすべて軸に沿う（斜めの線が無い）", () => {
    // 回転を反映しない判定なので、辺は必ず1軸だけが変わる
    for (const [a, b] of 線分(boundaryLines(箱(), KIND_3D))) {
      const 違う軸 = [0, 1, 2].filter((i) => a[i] !== b[i]);
      expect(違う軸.length).toBe(1);
    }
  });
});

describe("2Dの枠", () => {
  test("4本の辺になる", () => {
    const 線 = boundaryLines(箱(), KIND_2D);
    expect(線分(線).length).toBe(4);
  });

  test("奥行きを持たず、オブジェクトのZに置く", () => {
    const 線 = boundaryLines(箱(0, 0, 7), KIND_2D);
    for (let i = 2; i < 線.length; i += 3) expect(線[i]).toBe(7);
  });

  test("XYの範囲は判定どおり", () => {
    const 線 = boundaryLines(箱(10, 20, 0, 1, 2, 3), KIND_2D);
    const xs = [];
    const ys = [];
    for (let i = 0; i + 2 < 線.length; i += 3) {
      xs.push(線[i]); ys.push(線[i + 1]);
    }
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([9, 11]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([18, 22]);
  });
});

describe("球の枠", () => {
  test("3方向の輪になる", () => {
    const 線 = boundaryLines(球(), KIND_3D);
    const 本数 = 線分(線).length;
    expect(本数 % 3).toBe(0);
    expect(本数).toBeGreaterThan(30);
  });

  test("どの点も中心から半径ぶん離れている", () => {
    const 線 = boundaryLines(球(1, 2, 3, 2), KIND_3D);
    for (let i = 0; i + 2 < 線.length; i += 3) {
      const d = Math.hypot(線[i] - 1, 線[i + 1] - 2, 線[i + 2] - 3);
      expect(Math.abs(d - 2)).toBeLessThan(1e-6);
    }
  });

  test("2Dなら、球でも平らな輪1つにする", () => {
    const 線 = boundaryLines(球(0, 0, 5, 2), KIND_2D);
    for (let i = 2; i < 線.length; i += 3) expect(線[i]).toBe(5);
  });
});

describe("描かない場合", () => {
  test("判定が無ければ空", () => {
    expect(boundaryLines(null, KIND_3D)).toEqual(new Float32Array(0));
    expect(boundaryLines(undefined, KIND_3D)).toEqual(new Float32Array(0));
  });
});

describe("円柱の枠", () => {
  /** 円柱の判定 */
  const 柱 = (X = 0, Y = 0, Z = 0, r = 1, hh = 2) => ({
    shape: "cylinder", X, Y, Z, hw: r, hh, hd: r, r,
  });

  test("上下の輪と、縦の線で描く", () => {
    const 本数 = 線分(boundaryLines(柱(), KIND_3D)).length;
    // 輪2つ（24分割）＋ 縦4本
    expect(本数).toBe(24 * 2 + 4);
  });

  test("上下の面のYに置かれる", () => {
    const 線 = boundaryLines(柱(0, 5, 0, 1, 2), KIND_3D);
    const ys = new Set();
    for (let i = 1; i < 線.length; i += 3) ys.add(Math.round(線[i] * 1000) / 1000);
    expect([...ys].sort((a, b) => a - b)).toEqual([3, 7]);
  });

  test("輪の点は、中心から半径ぶん離れている", () => {
    const 線 = boundaryLines(柱(1, 0, 2, 3), KIND_3D);
    for (let i = 0; i + 2 < 線.length; i += 3) {
      const d = Math.hypot(線[i] - 1, 線[i + 2] - 2);
      expect(Math.abs(d - 3)).toBeLessThan(1e-6);
    }
  });

  test("2Dなら、横から見た矩形にする", () => {
    const 線 = boundaryLines(柱(0, 0, 7), KIND_2D);
    expect(線分(線).length).toBe(4);
    for (let i = 2; i < 線.length; i += 3) expect(線[i]).toBe(7);
  });
});

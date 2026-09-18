// 2Dスプライト（アニメパターン画像）の決まりのテスト（仕様書5.2 / 6.2.11節）
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_INTERVAL,
  normalizePattern,
  cellRect,
  createSpriteState,
  advanceSprite,
  currentCell,
  spriteUv,
  spriteQuad,
  screenProjection,
  sortSprites,
  planeNumbers,
  DEFAULT_PLANES,
  resolvePlane,
  splitByPlane,
} from "../web/sprite.js";
import { transformPoint } from "../web/matrix.js";

describe("アニメパターンの読み取り", () => {
  test("{ cells, interval } の形をそのまま読む", () => {
    expect(normalizePattern([{ cells: [0], interval: 30 }, { cells: [1, 2], interval: 4 }]))
      .toEqual([{ cells: [0], interval: 30 }, { cells: [1, 2], interval: 4 }]);
  });

  test("番号の配列だけを書いた場合は、既定の速さになる", () => {
    // 最初の書き方（[[0], [1, 2, 3, 2, 1], [4, 5]]）もそのまま使える
    expect(normalizePattern([[0], [1, 2, 3, 2, 1], [4, 5]])).toEqual([
      { cells: [0], interval: DEFAULT_INTERVAL },
      { cells: [1, 2, 3, 2, 1], interval: DEFAULT_INTERVAL },
      { cells: [4, 5], interval: DEFAULT_INTERVAL },
    ]);
  });

  test("既定の速さは6フレーム（60fpsで1秒に10コマ）", () => {
    expect(DEFAULT_INTERVAL).toBe(6);
  });

  test("速さが読めない・1未満なら既定へ戻す", () => {
    expect(normalizePattern([{ cells: [0], interval: 0 }])[0].interval).toBe(DEFAULT_INTERVAL);
    expect(normalizePattern([{ cells: [0], interval: "fast" }])[0].interval).toBe(DEFAULT_INTERVAL);
    // 小数は切り捨てる（フレーム数のため）
    expect(normalizePattern([{ cells: [0], interval: 2.7 }])[0].interval).toBe(2);
  });

  test("番号として読めないものは落とし、空になったパターンは捨てる", () => {
    expect(normalizePattern([[0, "x", -1, 1.5, 2], [], { cells: ["a"] }]))
      .toEqual([{ cells: [0, 2], interval: DEFAULT_INTERVAL }]);
  });

  test("配列でなければ空", () => {
    expect(normalizePattern(undefined)).toEqual([]);
    expect(normalizePattern("walk")).toEqual([]);
    expect(normalizePattern({ cells: [0] })).toEqual([]);
  });
});

describe("画像からのコマの切り出し", () => {
  // 256×64 の画像を 32 で切ると、横8列・縦2段の16コマ
  test("左上から右へ、行が終わったら次の段へ番号が振られる", () => {
    expect(cellRect(0, 32, 256, 64)).toEqual({ x: 0, y: 0, w: 32, h: 32 });
    expect(cellRect(7, 32, 256, 64)).toEqual({ x: 224, y: 0, w: 32, h: 32 });
    expect(cellRect(8, 32, 256, 64)).toEqual({ x: 0, y: 32, w: 32, h: 32 });
    expect(cellRect(15, 32, 256, 64)).toEqual({ x: 224, y: 32, w: 32, h: 32 });
  });

  test("画像に収まらない番号は null", () => {
    expect(cellRect(16, 32, 256, 64)).toBeNull();
    expect(cellRect(-1, 32, 256, 64)).toBeNull();
  });

  test("割り切れない端数は使わない", () => {
    // 100px 幅を 32 で切ると3列。4列目は無い
    expect(cellRect(2, 32, 100, 32)).toEqual({ x: 64, y: 0, w: 32, h: 32 });
    expect(cellRect(3, 32, 100, 32)).toBeNull();
  });

  test("大きさが使えない値なら null", () => {
    expect(cellRect(0, 0, 256, 64)).toBeNull();
    expect(cellRect(0, 32, 0, 64)).toBeNull();
  });
});

describe("コマ送り", () => {
  const patterns = normalizePattern([{ cells: [0], interval: 30 }, { cells: [1, 2, 3], interval: 2 }]);

  test("最初は先頭のコマ", () => {
    const state = createSpriteState();
    expect(currentCell(state, patterns)).toBe(0);
  });

  test("interval フレームごとに次のコマへ進み、終わったら先頭へ戻る", () => {
    let state = { ...createSpriteState(), anim: 1 };
    const seen = [];
    for (let i = 0; i < 8; i += 1) {
      seen.push(currentCell(state, patterns));
      state = advanceSprite(state, patterns, 1);
    }
    // interval 2 なので、2フレームずつ 1,1,2,2,3,3,1,1
    expect(seen).toEqual([1, 1, 2, 2, 3, 3, 1, 1]);
  });

  test("パターンを切り替えると先頭から始まる", () => {
    let state = { ...createSpriteState(), anim: 1 };
    state = advanceSprite(state, patterns, 1);
    state = advanceSprite(state, patterns, 1);
    state = advanceSprite(state, patterns, 1);
    expect(currentCell(state, patterns)).toBe(2);
    // @ANIM を 0 へ変えた
    state = advanceSprite(state, patterns, 0);
    expect(state.anim).toBe(0);
    expect(currentCell(state, patterns)).toBe(0);
  });

  test("無いパターン番号を指定したら、何も出さない", () => {
    const state = advanceSprite(createSpriteState(), patterns, 5);
    expect(currentCell(state, patterns)).toBeNull();
  });

  test("元の状態は書き換えない", () => {
    const before = createSpriteState();
    const after = advanceSprite(before, patterns, 1);
    expect(before).toEqual(createSpriteState());
    expect(after).not.toBe(before);
  });
});

describe("貼り付ける位置", () => {
  test("UVは画像の左上を (0,0) とする", () => {
    // WebGL へ画像をそのまま載せると、最初の行（画像の上端）が v=0 になる
    expect(spriteUv({ x: 64, y: 32, w: 32, h: 32 }, 256, 64)).toEqual([0.25, 0.5, 0.375, 1]);
  });

  test("四角は X,Y を中心に、コマの大きさ × SCALE で置く", () => {
    const q = spriteQuad({ X: 100, Y: 80, SIZE: 32, SCALEX: 1, SCALEY: 1, ROTZ: 0 });
    // 左上・右上・左下・右下
    expect(q).toEqual([84, 64, 116, 64, 84, 96, 116, 96]);
  });

  test("SCALEX を負にすると左右が入れ替わる（向きを変える）", () => {
    const q = spriteQuad({ X: 100, Y: 80, SIZE: 32, SCALEX: -1, SCALEY: 1, ROTZ: 0 });
    expect(q).toEqual([116, 64, 84, 64, 116, 96, 84, 96]);
  });

  test("SCALE で大きくなる", () => {
    const q = spriteQuad({ X: 0, Y: 0, SIZE: 10, SCALEX: 2, SCALEY: 3, ROTZ: 0 });
    expect(q).toEqual([-10, -15, 10, -15, -10, 15, 10, 15]);
  });

  test("ROTZ で回る（Yが下向きなので、正の角度は時計回り）", () => {
    const q = spriteQuad({ X: 0, Y: 0, SIZE: 2, SCALEX: 1, SCALEY: 1, ROTZ: 90 });
    // 左上 (-1,-1) が回って (1,-1) へ
    expect(q[0]).toBeCloseTo(1, 6);
    expect(q[1]).toBeCloseTo(-1, 6);
  });

  test("画面の左上が (0,0)、右下が (幅,高さ) になる正射影", () => {
    const m = screenProjection(640, 480);
    const tl = transformPoint(m, [0, 0, 0]);
    const br = transformPoint(m, [640, 480, 0]);
    expect(tl[0]).toBeCloseTo(-1, 6);
    expect(tl[1]).toBeCloseTo(1, 6);
    expect(br[0]).toBeCloseTo(1, 6);
    expect(br[1]).toBeCloseTo(-1, 6);
  });
});

describe("プレーン", () => {
  test("3Dの下は -1 から下へ、3Dの上は 0 から上へ番号が振られる", () => {
    expect(planeNumbers(2, 3)).toEqual([-2, -1, 0, 1, 2]);
    expect(planeNumbers(1, 1)).toEqual([-1, 0]);
  });

  test("0 や書かなかった時は、下は -1 だけ、上は 0 だけ", () => {
    expect(planeNumbers(0, 0)).toEqual([-1, 0]);
    expect(planeNumbers(undefined, undefined)).toEqual([-1, 0]);
    expect(planeNumbers("a", null)).toEqual([-1, 0]);
    expect(DEFAULT_PLANES).toEqual([-1, 0]);
  });

  test("下の枚数は、負の数で書いても枚数として読む。小数は切り捨て", () => {
    expect(planeNumbers(-3, 2.9)).toEqual([-3, -2, -1, 0, 1]);
  });

  test("多すぎる枚数は上限で止める", () => {
    // 片側 16 枚まで
    expect(planeNumbers(100, 100)).toHaveLength(32);
  });

  test("無いプレーン番号や省略は、0 のプレーンに置く", () => {
    const planes = [-1, 0, 1];
    expect(resolvePlane(1, planes)).toBe(1);
    expect(resolvePlane(-1, planes)).toBe(-1);
    expect(resolvePlane(5, planes)).toBe(0);
    expect(resolvePlane(-4, planes)).toBe(0);
    expect(resolvePlane(undefined, planes)).toBe(0);
    expect(resolvePlane("x", planes)).toBe(0);
    // 整数でない番号はプレーンが無いので 0
    expect(resolvePlane(0.6, planes)).toBe(0);
  });
});

describe("描く順", () => {
  test("2Dだけを取り出し、プレーン番号の小さいものから並べる（Zより優先）", () => {
    const a = { MODEL: "a.png", PLANE: 1, Z: -100, tag: "a" };
    const b = { MODEL: "b.png", PLANE: 0, Z: 100, tag: "b" };
    const c = { MODEL: "box", PLANE: -1, tag: "c" };
    const d = { MODEL: "cat.glb", tag: "d" };
    const e = { MODEL: "e.png", PLANE: -1, Z: 0, tag: "e" };
    expect(sortSprites([a, c, b, d, e], [-1, 0, 1]).map((o) => o.tag)).toEqual(["e", "b", "a"]);
  });

  test("同じプレーンなら Z の小さい順、同じZなら追加順（後のものが上）", () => {
    const list = [
      { MODEL: "a.png", PLANE: 0, Z: 5, tag: 1 },
      { MODEL: "b.png", PLANE: 0, Z: 0, tag: 2 },
      { MODEL: "c.png", PLANE: 0, Z: 0, tag: 3 },
    ];
    expect(sortSprites(list, [-1, 0]).map((o) => o.tag)).toEqual([2, 3, 1]);
  });

  test("PLANE や Z が無ければ 0 として扱う", () => {
    const list = [{ MODEL: "a.png", Z: 1, tag: 1 }, { MODEL: "b.png", tag: 2 }];
    expect(sortSprites(list, [-1, 0]).map((o) => o.tag)).toEqual([2, 1]);
  });

  test("無いプレーン番号は、0 のプレーンとして並ぶ", () => {
    const list = [
      { MODEL: "a.png", PLANE: 9, tag: 1 },
      { MODEL: "b.png", PLANE: 0, tag: 2 },
      { MODEL: "c.png", PLANE: -1, tag: 3 },
    ];
    // 9 は無いので 0 扱い。-1 が先、あとは追加順
    expect(sortSprites(list, [-1, 0]).map((o) => o.tag)).toEqual([3, 1, 2]);
  });

  test("3Dの下に描く分と上に描く分に分ける", () => {
    const list = [
      { MODEL: "a.png", PLANE: 0, tag: "a" },
      { MODEL: "b.png", PLANE: -2, tag: "b" },
      { MODEL: "c.png", PLANE: -1, tag: "c" },
      { MODEL: "d.png", PLANE: 1, tag: "d" },
    ];
    const { below, above } = splitByPlane(list, [-2, -1, 0, 1]);
    expect(below.map((o) => o.tag)).toEqual(["b", "c"]);
    expect(above.map((o) => o.tag)).toEqual(["a", "d"]);
  });
});

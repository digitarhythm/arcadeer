// 画像の詳細表示（左ペインの画像タブで選んだ画像をメイン部に出す）のテスト
import { describe, expect, test } from "bun:test";
import { fitZoom, cellGrid, sizeLabel, ZOOM_STEPS } from "../web/image-view.js";

describe("表示倍率", () => {
  test("小さな画像は、収まる範囲で整数倍に拡大する", () => {
    // 256×64 を 800×600 の場所へ → 横は 3 倍まで（3×256=768）、縦は 9 倍まで → 3
    expect(fitZoom(256, 64, 800, 600)).toBe(3);
  });

  test("それ以上大きくしない上限がある（ドット絵が巨大になりすぎないため）", () => {
    expect(fitZoom(16, 16, 2000, 2000)).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    expect(ZOOM_STEPS).toEqual([1, 2, 3, 4, 6, 8]);
  });

  test("収まらない大きな画像は、1未満に縮めて全体を見せる", () => {
    expect(fitZoom(1600, 400, 800, 600)).toBeCloseTo(0.5, 6);
    expect(fitZoom(400, 1200, 800, 600)).toBeCloseTo(0.5, 6);
  });

  test("ちょうど収まるなら等倍", () => {
    expect(fitZoom(800, 600, 800, 600)).toBe(1);
  });

  test("段階に無い倍率は、下の段階へ落とす", () => {
    // 5 倍まで入るが、段階は 4 の次が 6 なので 4
    expect(fitZoom(100, 100, 500, 500)).toBe(4);
  });

  test("大きさが取れなければ等倍", () => {
    expect(fitZoom(0, 0, 800, 600)).toBe(1);
    expect(fitZoom(256, 64, 0, 0)).toBe(1);
  });
});

describe("コマの区切り", () => {
  test("コマの大きさで区切り、左上から番号を振る（sprite.js と同じ数え方）", () => {
    const cells = cellGrid(96, 64, 32);
    expect(cells).toEqual([
      { index: 0, x: 0, y: 0 }, { index: 1, x: 32, y: 0 }, { index: 2, x: 64, y: 0 },
      { index: 3, x: 0, y: 32 }, { index: 4, x: 32, y: 32 }, { index: 5, x: 64, y: 32 },
    ]);
  });

  test("割り切れない端数は区切らない", () => {
    expect(cellGrid(100, 40, 32)).toEqual([
      { index: 0, x: 0, y: 0 }, { index: 1, x: 32, y: 0 }, { index: 2, x: 64, y: 0 },
    ]);
  });

  test("大きさが無い・画像より大きいなら区切らない", () => {
    expect(cellGrid(96, 64, 0)).toEqual([]);
    expect(cellGrid(96, 64, -1)).toEqual([]);
    expect(cellGrid(96, 64, "32")).toEqual([]);
    expect(cellGrid(96, 64, 128)).toEqual([]);
  });

  test("多すぎる区切りは作らない（小さすぎる値で固まらないため）", () => {
    // 1px で区切ると 4096×4096 個になるので、上限で止める
    expect(cellGrid(4096, 4096, 1).length).toBeLessThanOrEqual(4096);
  });
});

describe("大きさの表示", () => {
  test("幅 × 高さ をピクセルで", () => {
    expect(sizeLabel(256, 64)).toBe("256 × 64 px");
  });

  test("コマの大きさを添えると、何列 × 何段 かも出す", () => {
    expect(sizeLabel(256, 64, 32)).toBe("256 × 64 px（32 px × 8 × 2 = 16）");
  });

  test("区切れない時はコマの情報を出さない", () => {
    expect(sizeLabel(256, 64, 0)).toBe("256 × 64 px");
    expect(sizeLabel(20, 20, 32)).toBe("20 × 20 px");
  });
});

// 描画対象の選別と配置行列のテスト
import { describe, expect, test } from "bun:test";
import {
  isRenderable3D,
  modelMatrix,
  modelsUsedBy,
  isPrimitive,
  KIND_NONE,
  KIND_PRIMITIVE,
  KIND_2D,
  KIND_3D,
} from "../web/scene.js";
import { transformPoint } from "../web/matrix.js";

/** 最低限の項目を持つオブジェクトを作る */
function obj(extra = {}) {
  return { KIND: KIND_3D, MODEL: "cat.glb", X: 0, Y: 0, Z: 0, ...extra };
}

describe("描画対象の選別", () => {
  test("3Dかつモデル指定があれば対象になる", () => {
    expect(isRenderable3D(obj())).toBe(true);
    expect(isRenderable3D(obj({ MODEL: "ship.gltf" }))).toBe(true);
  });

  test("2Dオブジェクトは3D描画の対象にしない", () => {
    expect(isRenderable3D(obj({ KIND: KIND_2D }))).toBe(false);
    expect(isRenderable3D(obj({ KIND: KIND_PRIMITIVE }))).toBe(false);
    expect(isRenderable3D(obj({ KIND: KIND_NONE }))).toBe(false);
  });

  test("モデル以外の指定は対象にしない", () => {
    expect(isRenderable3D(obj({ MODEL: "primitive" }))).toBe(false);
    expect(isRenderable3D(obj({ MODEL: "player.png" }))).toBe(false);
    expect(isRenderable3D(obj({ MODEL: "" }))).toBe(false);
  });

  test("拡張子の大文字小文字は区別しない", () => {
    expect(isRenderable3D(obj({ MODEL: "CAT.GLB" }))).toBe(true);
  });

  test("項目が欠けていても壊れない", () => {
    expect(isRenderable3D({})).toBe(false);
    expect(isRenderable3D(null)).toBe(false);
  });
});

describe("配置行列", () => {
  test("座標のぶんだけ移動する", () => {
    const m = modelMatrix(obj({ X: 1, Y: 2, Z: 3 }));
    expect(transformPoint(m, [0, 0, 0])).toEqual([1, 2, 3]);
  });

  test("座標が無ければ原点に置く", () => {
    expect(transformPoint(modelMatrix({}), [0, 0, 0])).toEqual([0, 0, 0]);
  });

  test("数値でない座標は0として扱う", () => {
    const m = modelMatrix({ X: "abc", Y: null, Z: undefined });
    expect(transformPoint(m, [0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe("回転と拡大縮小", () => {
  /** 誤差を許して比べる */
  const close = (a, b, tol = 1e-5) => {
    for (let i = 0; i < b.length; i += 1) expect(Math.abs(a[i] - b[i])).toBeLessThan(tol);
  };

  test("回転は度で指定する", () => {
    // Y軸90度で、+X の点が -Z へ向く
    const m = modelMatrix(obj({ ROTY: 90 }));
    close(transformPoint(m, [1, 0, 0]), [0, 0, -1]);
  });

  test("X軸まわりに回せる", () => {
    // X軸90度で、+Y の点が +Z へ向く
    close(transformPoint(modelMatrix(obj({ ROTX: 90 })), [0, 1, 0]), [0, 0, 1]);
  });

  test("Z軸まわりに回せる", () => {
    // Z軸90度で、+X の点が +Y へ向く
    close(transformPoint(modelMatrix(obj({ ROTZ: 90 })), [1, 0, 0]), [0, 1, 0]);
  });

  test("回転の適用順は Z → X → Y", () => {
    // Z軸90度で +X が +Y へ、そのあと X軸90度で +Y が +Z へ向く
    close(transformPoint(modelMatrix(obj({ ROTZ: 90, ROTX: 90 })), [1, 0, 0]), [0, 0, 1]);
  });

  test("回転してから移動する", () => {
    const m = modelMatrix(obj({ X: 10, ROTY: 90 }));
    close(transformPoint(m, [1, 0, 0]), [10, 0, -1]);
  });

  test("拡大縮小が効く", () => {
    const m = modelMatrix(obj({ SCALEX: 2, SCALEY: 3, SCALEZ: 4 }));
    close(transformPoint(m, [1, 1, 1]), [2, 3, 4]);
  });

  test("拡大してから回転する", () => {
    const m = modelMatrix(obj({ SCALEX: 2, ROTY: 90 }));
    close(transformPoint(m, [1, 0, 0]), [0, 0, -2]);
  });

  test("指定が無ければ回転せず等倍のまま", () => {
    close(transformPoint(modelMatrix(obj()), [1, 2, 3]), [1, 2, 3]);
  });

  test("数値でない回転は0として扱う", () => {
    close(transformPoint(modelMatrix(obj({ ROTY: "abc" })), [1, 0, 0]), [1, 0, 0]);
  });

  test("数値でない拡大率は1として扱う", () => {
    close(transformPoint(modelMatrix(obj({ SCALEX: null })), [1, 0, 0]), [1, 0, 0]);
  });
});

describe("使っているモデルの洗い出し", () => {
  test("重複を除いて集める", () => {
    const objects = [obj(), obj(), obj({ MODEL: "ship.glb" })];
    expect(modelsUsedBy(objects).sort()).toEqual(["cat.glb", "ship.glb"]);
  });

  test("描画対象でないものは含めない", () => {
    const objects = [obj({ KIND: KIND_2D }), obj({ MODEL: "box" }), obj()];
    expect(modelsUsedBy(objects)).toEqual(["cat.glb"]);
  });

  test("空でも壊れない", () => {
    expect(modelsUsedBy([])).toEqual([]);
  });
});

describe("オブジェクトの種別（KIND）", () => {
  test("番号の割り当て", () => {
    expect(KIND_NONE).toBe(0);
    expect(KIND_PRIMITIVE).toBe(1);
    expect(KIND_2D).toBe(2);
    expect(KIND_3D).toBe(3);
  });
});

describe("プリミティブの判定", () => {
  const prim = (extra = {}) => ({ KIND: KIND_PRIMITIVE, MODEL: "box", ...extra });

  test("KINDが0で、MODELが組み込み形状名なら描く", () => {
    expect(isPrimitive(prim())).toBe(true);
    expect(isPrimitive(prim({ MODEL: "sphere" }))).toBe(true);
  });

  test("KINDが違えば描かない", () => {
    expect(isPrimitive(prim({ KIND: KIND_2D }))).toBe(false);
    expect(isPrimitive(prim({ KIND: KIND_3D }))).toBe(false);
  });

  test("知らない形状名なら描かない", () => {
    expect(isPrimitive(prim({ MODEL: "torus" }))).toBe(false);
    expect(isPrimitive(prim({ MODEL: "cat.glb" }))).toBe(false);
    expect(isPrimitive(prim({ MODEL: "" }))).toBe(false);
    expect(isPrimitive(prim({ MODEL: undefined }))).toBe(false);
  });

  test("空の値でも落ちない", () => {
    expect(isPrimitive(null)).toBe(false);
    expect(isPrimitive(undefined)).toBe(false);
  });

  test("3Dモデルの一覧にはプリミティブを含めない", () => {
    // プリミティブは内部で作るため、ファイルの読み込みは要らない
    expect(modelsUsedBy([prim(), obj()])).toEqual(["cat.glb"]);
  });
});

describe("種別の名前指定と自動判定", () => {
  test("名前で指定できる", () => {
    expect(isRenderable3D({ KIND: "3D", MODEL: "cat.glb" })).toBe(true);
    expect(isPrimitive({ KIND: "PRIM", MODEL: "box" })).toBe(true);
  });

  test("大文字小文字は区別しない", () => {
    expect(isRenderable3D({ KIND: "3d", MODEL: "cat.glb" })).toBe(true);
    expect(isPrimitive({ KIND: "prim", MODEL: "box" })).toBe(true);
  });

  test("指定が無ければ MODEL から決まる", () => {
    expect(isRenderable3D({ MODEL: "cat.glb" })).toBe(true);
    expect(isPrimitive({ MODEL: "box" })).toBe(true);
    // 画像は3Dでもプリミティブでもない
    expect(isRenderable3D({ MODEL: "player.png" })).toBe(false);
    expect(isPrimitive({ MODEL: "player.png" })).toBe(false);
  });

  test("数値での指定も引き続き使える", () => {
    expect(isRenderable3D({ KIND: 3, MODEL: "cat.glb" })).toBe(true);
    expect(isPrimitive({ KIND: 1, MODEL: "box" })).toBe(true);
  });

  test("管理用（NONE）はどちらとしても描かない", () => {
    // gameMain のように、画面に出さず処理だけを持つオブジェクト
    expect(isRenderable3D({ KIND: "NONE", MODEL: "cat.glb" })).toBe(false);
    expect(isPrimitive({ KIND: "NONE", MODEL: "box" })).toBe(false);
    // MODEL が無ければ、指定しなくても管理用になる
    expect(isPrimitive({})).toBe(false);
    expect(isRenderable3D({})).toBe(false);
  });

  test("明示した指定は MODEL より優先する", () => {
    // 3Dモデルを指定していても、PRIM と書けば3Dとしては描かない
    expect(isRenderable3D({ KIND: "PRIM", MODEL: "cat.glb" })).toBe(false);
  });
});

// 当たり判定のテスト（仕様書5.5節）
import { afterEach, describe, expect, test } from "bun:test";

import {
  boundsOf,
  hitBetween,
  hitBetweenXY,
  findHit,
  setModelBoxLookup,
} from "../web/collision.js";

/** 判定を持つオブジェクトを作る */
const obj = (X, Y, Z, BOUNDARY = {}, 他 = {}) => ({
  X, Y, Z, SCALEX: 1, SCALEY: 1, SCALEZ: 1, ROTX: 0, ROTY: 0, ROTZ: 0,
  BOUNDARY, ...他,
});

describe("判定の形", () => {
  test("BOUNDARY が無ければ、判定を持たない", () => {
    expect(boundsOf({ X: 0, Y: 0, Z: 0 })).toBeNull();
    expect(boundsOf(obj(0, 0, 0, null))).toBeNull();
    expect(boundsOf({ X: 0, Y: 0, Z: 0, BOUNDARY: undefined })).toBeNull();
    // 書き間違えて別のものを入れてしまった場合も、判定なしとして扱う
    expect(boundsOf(obj(0, 0, 0, "はこ"))).toBeNull();
  });

  test("既定は 1×1×1 の直方体（オブジェクトの位置が中心）", () => {
    expect(boundsOf(obj(0, 0, 0))).toEqual({
      shape: "box",
      X: 0, Y: 0, Z: 0,
      hw: 0.5, hh: 0.5, hd: 0.5,
      r: 0.5,
    });
  });

  test("大きさを指定できる", () => {
    const b = boundsOf(obj(0, 0, 0, { width: 4, height: 2, depth: 6 }));
    expect([b.hw, b.hh, b.hd]).toEqual([2, 1, 3]);
  });

  test("ずれを指定できる", () => {
    const b = boundsOf(obj(10, 20, 30, { offsetX: 1, offsetY: -2, offsetZ: 3 }));
    expect([b.X, b.Y, b.Z]).toEqual([11, 18, 33]);
  });

  test("球は半径で決まる（既定は 0.5）", () => {
    expect(boundsOf(obj(0, 0, 0, { shape: "sphere" })).r).toBe(0.5);
    expect(boundsOf(obj(0, 0, 0, { shape: "sphere", radius: 3 })).r).toBe(3);
  });

  test("知らない形は直方体として扱う", () => {
    expect(boundsOf(obj(0, 0, 0, { shape: "まる" })).shape).toBe("box");
  });

  test("扱えない大きさは既定へ戻す", () => {
    const b = boundsOf(obj(0, 0, 0, { width: -1, height: "おおきい", depth: 0 }));
    expect([b.hw, b.hh, b.hd]).toEqual([0.5, 0.5, 0.5]);
  });

  test("拡大縮小は判定に効かない", () => {
    // 見栄えと判定を切り離すのが目的なので、SCALE では変えない
    const 普通 = boundsOf(obj(0, 0, 0, {}, { SCALEX: 1 }));
    const 大きい = boundsOf(obj(0, 0, 0, {}, { SCALEX: 100, SCALEY: 100, SCALEZ: 100 }));
    expect(大きい).toEqual(普通);
  });

  test("回転は判定に効かない", () => {
    const 普通 = boundsOf(obj(0, 0, 0, { width: 4 }));
    const 回した = boundsOf(obj(0, 0, 0, { width: 4 }, { ROTY: 45, ROTX: 30, ROTZ: 90 }));
    expect(回した).toEqual(普通);
  });
});

describe("2つの当たり", () => {
  test("重なっていれば当たり", () => {
    expect(hitBetween(boundsOf(obj(0, 0, 0)), boundsOf(obj(0.5, 0, 0)))).toBe(true);
  });

  test("離れていれば当たらない", () => {
    expect(hitBetween(boundsOf(obj(0, 0, 0)), boundsOf(obj(2, 0, 0)))).toBe(false);
  });

  test("接している（境目が一致する）場合も当たり", () => {
    // 1ドットの判定を置いた時に、端で拾えなくなるのを避ける
    expect(hitBetween(boundsOf(obj(0, 0, 0)), boundsOf(obj(1, 0, 0)))).toBe(true);
  });

  test("どれか1軸でも離れていれば当たらない", () => {
    expect(hitBetween(boundsOf(obj(0, 0, 0)), boundsOf(obj(0, 0, 5)))).toBe(false);
    expect(hitBetween(boundsOf(obj(0, 0, 0)), boundsOf(obj(0, 5, 0)))).toBe(false);
  });

  test("球どうしは中心の距離で見る", () => {
    const a = boundsOf(obj(0, 0, 0, { shape: "sphere", radius: 1 }));
    const 近い = boundsOf(obj(1.5, 0, 0, { shape: "sphere", radius: 1 }));
    const 遠い = boundsOf(obj(2.5, 0, 0, { shape: "sphere", radius: 1 }));
    expect(hitBetween(a, 近い)).toBe(true);
    expect(hitBetween(a, 遠い)).toBe(false);
    // 斜めでも、角ではなく距離で判断する（直方体との違い）
    const 斜め = boundsOf(obj(1.5, 1.5, 0, { shape: "sphere", radius: 1 }));
    expect(hitBetween(a, 斜め)).toBe(false);
  });

  test("球と直方体は、いちばん近い点までの距離で見る", () => {
    const 箱 = boundsOf(obj(0, 0, 0, { width: 2, height: 2, depth: 2 }));
    expect(hitBetween(箱, boundsOf(obj(1.5, 0, 0, { shape: "sphere", radius: 1 })))).toBe(true);
    expect(hitBetween(箱, boundsOf(obj(2.5, 0, 0, { shape: "sphere", radius: 1 })))).toBe(false);
    // 角のそば。中心どうしは遠いが、角には触れている
    expect(hitBetween(箱, boundsOf(obj(1.5, 1.5, 0, { shape: "sphere", radius: 1 })))).toBe(true);
    // 順番を入れ替えても同じ
    const 球 = boundsOf(obj(1.5, 1.5, 0, { shape: "sphere", radius: 1 }));
    expect(hitBetween(球, 箱)).toBe(true);
  });

  test("判定を持たないものは、当たらない", () => {
    expect(hitBetween(null, boundsOf(obj(0, 0, 0)))).toBe(false);
    expect(hitBetween(boundsOf(obj(0, 0, 0)), null)).toBe(false);
  });
});

describe("2Dの重なり（奥行きを見ない）", () => {
  test("Zが離れていても、XYが重なっていれば当たり", () => {
    const a = boundsOf(obj(0, 0, 0));
    const b = boundsOf(obj(0.5, 0, 100));
    expect(hitBetween(a, b)).toBe(false);
    expect(hitBetweenXY(a, b)).toBe(true);
  });

  test("XYが離れていれば当たらない", () => {
    expect(hitBetweenXY(boundsOf(obj(0, 0, 0)), boundsOf(obj(5, 0, 0)))).toBe(false);
    expect(hitBetweenXY(boundsOf(obj(0, 0, 0)), boundsOf(obj(0, 5, 0)))).toBe(false);
  });

  test("球は円として見る", () => {
    const a = boundsOf(obj(0, 0, 0, { shape: "sphere", radius: 1 }));
    const 近い = boundsOf(obj(1.5, 0, 50, { shape: "sphere", radius: 1 }));
    const 斜め = boundsOf(obj(1.5, 1.5, 50, { shape: "sphere", radius: 1 }));
    expect(hitBetweenXY(a, 近い)).toBe(true);
    expect(hitBetweenXY(a, 斜め)).toBe(false);
  });

  test("球と直方体も奥行きを見ない", () => {
    const 箱 = boundsOf(obj(0, 0, 0, { width: 2, height: 2, depth: 2 }));
    const 球 = boundsOf(obj(1.5, 1.5, 99, { shape: "sphere", radius: 1 }));
    expect(hitBetweenXY(箱, 球)).toBe(true);
  });
});

describe("相手を指定して調べる", () => {
  test("当たっていれば、その相手を返す", () => {
    const 自分 = obj(0, 0, 0);
    const 相手 = obj(0.5, 0, 0);
    expect(findHit(自分, 相手)).toBe(相手);
  });

  test("当たっていなければ null", () => {
    expect(findHit(obj(0, 0, 0), obj(9, 0, 0))).toBeNull();
  });

  test("配列を渡せる。最初に当たった相手を返す", () => {
    const 自分 = obj(0, 0, 0);
    const 外れ = obj(9, 0, 0);
    const 当たり = obj(0.5, 0, 0);
    const もう一つ = obj(-0.5, 0, 0);
    expect(findHit(自分, [外れ, 当たり, もう一つ])).toBe(当たり);
  });

  test("自分自身は当たらない", () => {
    const 自分 = obj(0, 0, 0);
    expect(findHit(自分, 自分)).toBeNull();
    expect(findHit(自分, [自分])).toBeNull();
  });

  test("判定を持たない相手は飛ばす", () => {
    const 自分 = obj(0, 0, 0);
    const 判定なし = { X: 0, Y: 0, Z: 0, BOUNDARY: null };
    const 当たり = obj(0.5, 0, 0);
    expect(findHit(自分, [判定なし, 当たり])).toBe(当たり);
  });

  test("自分が判定を持たなければ、何とも当たらない", () => {
    const 自分 = { X: 0, Y: 0, Z: 0, BOUNDARY: null };
    expect(findHit(自分, obj(0, 0, 0))).toBeNull();
  });

  test("2Dとして調べられる", () => {
    const 自分 = obj(0, 0, 0);
    const 奥 = obj(0.5, 0, 100);
    expect(findHit(自分, 奥)).toBeNull();
    expect(findHit(自分, 奥, "2d")).toBe(奥);
  });

  test("おかしなものを渡しても落ちない", () => {
    const 自分 = obj(0, 0, 0);
    expect(findHit(自分, null)).toBeNull();
    expect(findHit(自分, undefined)).toBeNull();
    expect(findHit(自分, [null, undefined])).toBeNull();
    expect(findHit(自分, [])).toBeNull();
  });
});

describe("BOUNDARY を書かない場合は、見た目そのものが判定になる", () => {
  /** 見た目を持つオブジェクト（BOUNDARY は書かない） */
  const 見た目 = (MODEL, 他 = {}) => ({
    X: 0, Y: 0, Z: 0, SCALEX: 1, SCALEY: 1, SCALEZ: 1, ROTX: 0, ROTY: 0, ROTZ: 0,
    MODEL, ...他,
  });

  afterEach(() => {
    setModelBoxLookup(null);
  });

  test("プリミティブは 1×1×1（正規化された大きさ）", () => {
    const b = boundsOf(見た目("box"));
    expect([b.hw, b.hh, b.hd]).toEqual([0.5, 0.5, 0.5]);
    expect([b.X, b.Y, b.Z]).toEqual([0, 0, 0]);
  });

  test("プリミティブは拡大縮小が効く", () => {
    // 自分で書いた判定と違い、こちらは**見た目そのもの**なので SCALE に従う
    const b = boundsOf(見た目("cylinder", { SCALEX: 10, SCALEY: 2, SCALEZ: 10 }));
    expect([b.hw, b.hh, b.hd]).toEqual([5, 1, 5]);
  });

  test("見た目でも回転は効かない", () => {
    const 普通 = boundsOf(見た目("box"));
    const 回した = boundsOf(見た目("box", { ROTY: 45, ROTX: 30, ROTZ: 90 }));
    expect(回した).toEqual(普通);
  });

  test("位置は座標のとおり", () => {
    const b = boundsOf(見た目("box", { X: 3, Y: -1, Z: 2 }));
    expect([b.X, b.Y, b.Z]).toEqual([3, -1, 2]);
  });

  test("3Dモデルは、モデルの外接直方体を使う", () => {
    setModelBoxLookup((name) =>
      name === "cat.glb" ? { center: [0, 1, 0], half: [0.5, 1, 0.25] } : null);
    const b = boundsOf(見た目("cat.glb"));
    expect([b.hw, b.hh, b.hd]).toEqual([0.5, 1, 0.25]);
    // モデルの中心がずれていれば、そのぶん判定もずれる
    expect([b.X, b.Y, b.Z]).toEqual([0, 1, 0]);
  });

  test("3Dモデルも拡大縮小が効く（中心のずれも一緒に伸びる）", () => {
    setModelBoxLookup(() => ({ center: [0, 1, 0], half: [0.5, 1, 0.25] }));
    const b = boundsOf(見た目("cat.glb", { X: 10, SCALEX: 2, SCALEY: 3, SCALEZ: 4 }));
    expect([b.hw, b.hh, b.hd]).toEqual([1, 3, 1]);
    expect([b.X, b.Y, b.Z]).toEqual([10, 3, 0]);
  });

  test("まだ読み込めていないモデルは、判定を持たない", () => {
    setModelBoxLookup(() => null);
    expect(boundsOf(見た目("cat.glb"))).toBeNull();
  });

  test("画面に出さない管理用は、判定を持たない", () => {
    // 表示していない以上、当たるものが無い
    expect(boundsOf(見た目("", { KIND: "NONE" }))).toBeNull();
    expect(boundsOf(見た目("box", { KIND: "NONE" }))).toBeNull();
    expect(boundsOf({ X: 0, Y: 0, Z: 0 })).toBeNull();
  });

  test("null や false を書けば、判定を外せる", () => {
    expect(boundsOf(見た目("box", { BOUNDARY: null }))).toBeNull();
    expect(boundsOf(見た目("box", { BOUNDARY: false }))).toBeNull();
  });

  test("自分で書いた場合は、これまでどおり拡大縮小が効かない", () => {
    const b = boundsOf(見た目("box", { SCALEX: 10, BOUNDARY: { width: 2 } }));
    expect(b.hw).toBe(1);
  });

  test("見た目どうしでも当たりを取れる", () => {
    const 地面 = 見た目("cylinder", { Y: -0.5, SCALEX: 10, SCALEZ: 10 });
    const 猫 = 見た目("box", { Y: 0 });
    expect(findHit(猫, 地面)).toBe(地面);
    expect(findHit(地面, 猫)).toBe(猫);
  });
});

describe("円柱の判定", () => {
  /** 円柱の判定を持つオブジェクト */
  const 柱 = (X, Y, Z, 他 = {}) =>
    obj(X, Y, Z, { shape: "cylinder", radius: 1, height: 2, ...他 });

  test("半径と高さで決まる（既定は半径0.5・高さ1）", () => {
    const b = boundsOf(obj(0, 0, 0, { shape: "cylinder" }));
    expect(b.shape).toBe("cylinder");
    expect(b.r).toBe(0.5);
    expect(b.hh).toBe(0.5);
    // 横幅は半径にそろえる（外接する直方体として扱えるように）
    expect([b.hw, b.hd]).toEqual([0.5, 0.5]);
  });

  test("半径と高さを指定できる", () => {
    const b = boundsOf(柱(0, 0, 0));
    expect([b.r, b.hh]).toEqual([1, 1]);
  });

  test("扱えない値は既定へ戻す", () => {
    const b = boundsOf(obj(0, 0, 0, { shape: "cylinder", radius: -1, height: "たかい" }));
    expect([b.r, b.hh]).toEqual([0.5, 0.5]);
  });

  test("円柱どうしは、XZの円とYの範囲で見る", () => {
    const a = boundsOf(柱(0, 0, 0));
    // XZ が重なり、Y も重なる
    expect(hitBetween(a, boundsOf(柱(1.5, 0, 0)))).toBe(true);
    // XZ が離れている
    expect(hitBetween(a, boundsOf(柱(2.5, 0, 0)))).toBe(false);
    // XZ は重なるが、Y が離れている
    expect(hitBetween(a, boundsOf(柱(0, 3, 0)))).toBe(false);
    // 斜めでも、角ではなく距離で見る（直方体との違い）
    expect(hitBetween(a, boundsOf(柱(1.5, 0, 1.5)))).toBe(false);
  });

  test("円柱と直方体は、XZの円と矩形で見る", () => {
    const 柱b = boundsOf(柱(0, 0, 0));
    const 箱 = (X, Y, Z) => boundsOf(obj(X, Y, Z, { width: 2, height: 2, depth: 2 }));
    expect(hitBetween(柱b, 箱(1.5, 0, 0))).toBe(true);
    expect(hitBetween(柱b, 箱(2.5, 0, 0))).toBe(false);
    // 角のそば。中心どうしは遠いが、角には触れている
    expect(hitBetween(柱b, 箱(1.7, 0, 1.7))).toBe(true);
    // 角からも離れている
    expect(hitBetween(柱b, 箱(2.5, 0, 2.5))).toBe(false);
    // Y が離れていれば当たらない
    expect(hitBetween(柱b, 箱(0, 3, 0))).toBe(false);
    // 順番を入れ替えても同じ
    expect(hitBetween(箱(1.5, 0, 0), 柱b)).toBe(true);
  });

  test("円柱と球は、いちばん近い点までの距離で見る", () => {
    const 柱b = boundsOf(柱(0, 0, 0));
    const 球 = (X, Y, Z, radius = 0.5) => boundsOf(obj(X, Y, Z, { shape: "sphere", radius }));
    // 真横
    expect(hitBetween(柱b, 球(1.4, 0, 0))).toBe(true);
    expect(hitBetween(柱b, 球(1.6, 0, 0))).toBe(false);
    // 真上
    expect(hitBetween(柱b, 球(0, 1.4, 0))).toBe(true);
    expect(hitBetween(柱b, 球(0, 1.6, 0))).toBe(false);
    // 上の縁のそば。横にも上にもはみ出しているので、斜めの距離で見る。
    // 縁からの距離は √((1.2-1)² + (1.2-1)²) ≈ 0.283 なので、半径0.5なら届く
    expect(hitBetween(柱b, 球(1.2, 1.2, 0))).toBe(true);
    // √((1.5-1)² + (1.5-1)²) ≈ 0.707 なので、半径0.5では届かない
    expect(hitBetween(柱b, 球(1.5, 1.5, 0))).toBe(false);
    // 順番を入れ替えても同じ
    expect(hitBetween(球(1.4, 0, 0), 柱b)).toBe(true);
  });

  test("2Dでは、横から見た矩形として扱う", () => {
    const a = boundsOf(柱(0, 0, 0));
    // Zが離れていても、XYが重なっていれば当たり
    expect(hitBetweenXY(a, boundsOf(柱(1.5, 0, 100)))).toBe(true);
    // 幅は半径ぶん、高さは指定どおり
    expect(hitBetweenXY(a, boundsOf(obj(2.1, 0, 0, { width: 0.2 })))).toBe(false);
    expect(hitBetweenXY(a, boundsOf(obj(0, 1.2, 0, { height: 0.2 })))).toBe(false);
    expect(hitBetweenXY(a, boundsOf(obj(0, 1.05, 0, { height: 0.2 })))).toBe(true);
  });
});

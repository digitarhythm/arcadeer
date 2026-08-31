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
const obj = (X, Y, Z, BOUNDARY = {}, extra = {}) => ({
  X, Y, Z, SCALEX: 1, SCALEY: 1, SCALEZ: 1, ROTX: 0, ROTY: 0, ROTZ: 0,
  BOUNDARY, ...extra,
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
    const b = boundsOf(obj(0, 0, 0, { SCALEX: 4, SCALEY: 2, SCALEZ: 6 }));
    expect([b.hw, b.hh, b.hd]).toEqual([2, 1, 3]);
  });

  test("ずれを指定できる", () => {
    const b = boundsOf(obj(10, 20, 30, { X: 1, Y: -2, Z: 3 }));
    expect([b.X, b.Y, b.Z]).toEqual([11, 18, 33]);
  });

  test("球は半径で決まる（既定は 0.5）", () => {
    expect(boundsOf(obj(0, 0, 0, { MODEL: "sphere" })).r).toBe(0.5);
    expect(boundsOf(obj(0, 0, 0, { MODEL: "sphere", RADIUS: 3 })).r).toBe(3);
  });

  test("知らない形は直方体として扱う", () => {
    expect(boundsOf(obj(0, 0, 0, { MODEL: "まる" })).shape).toBe("box");
  });

  test("扱えない大きさは既定へ戻す", () => {
    const b = boundsOf(obj(0, 0, 0, { SCALEX: -1, SCALEY: "おおきい", SCALEZ: 0 }));
    expect([b.hw, b.hh, b.hd]).toEqual([0.5, 0.5, 0.5]);
  });

  test("拡大縮小は判定に効かない", () => {
    // 見栄えと判定を切り離すのが目的なので、SCALE では変えない
    const plain = boundsOf(obj(0, 0, 0, {}, { SCALEX: 1 }));
    const big = boundsOf(obj(0, 0, 0, {}, { SCALEX: 100, SCALEY: 100, SCALEZ: 100 }));
    expect(big).toEqual(plain);
  });

  test("回転は判定に効かない", () => {
    const plain = boundsOf(obj(0, 0, 0, { SCALEX: 4 }));
    const turned = boundsOf(obj(0, 0, 0, { SCALEX: 4 }, { ROTY: 45, ROTX: 30, ROTZ: 90 }));
    expect(turned).toEqual(plain);
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
    const a = boundsOf(obj(0, 0, 0, { MODEL: "sphere", RADIUS: 1 }));
    const near = boundsOf(obj(1.5, 0, 0, { MODEL: "sphere", RADIUS: 1 }));
    const distant = boundsOf(obj(2.5, 0, 0, { MODEL: "sphere", RADIUS: 1 }));
    expect(hitBetween(a, near)).toBe(true);
    expect(hitBetween(a, distant)).toBe(false);
    // 斜めでも、角ではなく距離で判断する（直方体との違い）
    const diagonal = boundsOf(obj(1.5, 1.5, 0, { MODEL: "sphere", RADIUS: 1 }));
    expect(hitBetween(a, diagonal)).toBe(false);
  });

  test("球と直方体は、いちばん近い点までの距離で見る", () => {
    const box = boundsOf(obj(0, 0, 0, { SCALEX: 2, SCALEY: 2, SCALEZ: 2 }));
    expect(hitBetween(box, boundsOf(obj(1.5, 0, 0, { MODEL: "sphere", RADIUS: 1 })))).toBe(true);
    expect(hitBetween(box, boundsOf(obj(2.5, 0, 0, { MODEL: "sphere", RADIUS: 1 })))).toBe(false);
    // 角のそば。中心どうしは遠いが、角には触れている
    expect(hitBetween(box, boundsOf(obj(1.5, 1.5, 0, { MODEL: "sphere", RADIUS: 1 })))).toBe(true);
    // 順番を入れ替えても同じ
    const sphere = boundsOf(obj(1.5, 1.5, 0, { MODEL: "sphere", RADIUS: 1 }));
    expect(hitBetween(sphere, box)).toBe(true);
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
    const a = boundsOf(obj(0, 0, 0, { MODEL: "sphere", RADIUS: 1 }));
    const near = boundsOf(obj(1.5, 0, 50, { MODEL: "sphere", RADIUS: 1 }));
    const diagonal = boundsOf(obj(1.5, 1.5, 50, { MODEL: "sphere", RADIUS: 1 }));
    expect(hitBetweenXY(a, near)).toBe(true);
    expect(hitBetweenXY(a, diagonal)).toBe(false);
  });

  test("球と直方体も奥行きを見ない", () => {
    const box = boundsOf(obj(0, 0, 0, { SCALEX: 2, SCALEY: 2, SCALEZ: 2 }));
    const sphere = boundsOf(obj(1.5, 1.5, 99, { MODEL: "sphere", RADIUS: 1 }));
    expect(hitBetweenXY(box, sphere)).toBe(true);
  });
});

describe("相手を指定して調べる", () => {
  test("当たっていれば、その相手を返す", () => {
    const mine = obj(0, 0, 0);
    const other = obj(0.5, 0, 0);
    expect(findHit(mine, other)).toBe(other);
  });

  test("当たっていなければ null", () => {
    expect(findHit(obj(0, 0, 0), obj(9, 0, 0))).toBeNull();
  });

  test("配列を渡せる。最初に当たった相手を返す", () => {
    const mine = obj(0, 0, 0);
    const miss = obj(9, 0, 0);
    const hit = obj(0.5, 0, 0);
    const another = obj(-0.5, 0, 0);
    expect(findHit(mine, [miss, hit, another])).toBe(hit);
  });

  test("自分自身は当たらない", () => {
    const mine = obj(0, 0, 0);
    expect(findHit(mine, mine)).toBeNull();
    expect(findHit(mine, [mine])).toBeNull();
  });

  test("判定を持たない相手は飛ばす", () => {
    const mine = obj(0, 0, 0);
    const noBounds = { X: 0, Y: 0, Z: 0, BOUNDARY: null };
    const hit = obj(0.5, 0, 0);
    expect(findHit(mine, [noBounds, hit])).toBe(hit);
  });

  test("自分が判定を持たなければ、何とも当たらない", () => {
    const mine = { X: 0, Y: 0, Z: 0, BOUNDARY: null };
    expect(findHit(mine, obj(0, 0, 0))).toBeNull();
  });

  test("2Dとして調べられる", () => {
    const mine = obj(0, 0, 0);
    const far = obj(0.5, 0, 100);
    expect(findHit(mine, far)).toBeNull();
    expect(findHit(mine, far, "2d")).toBe(far);
  });

  test("おかしなものを渡しても落ちない", () => {
    const mine = obj(0, 0, 0);
    expect(findHit(mine, null)).toBeNull();
    expect(findHit(mine, undefined)).toBeNull();
    expect(findHit(mine, [null, undefined])).toBeNull();
    expect(findHit(mine, [])).toBeNull();
  });
});

describe("BOUNDARY を書かない場合は、見た目そのものが判定になる", () => {
  /** 見た目を持つオブジェクト（BOUNDARY は書かない） */
  const look = (MODEL, extra = {}) => ({
    X: 0, Y: 0, Z: 0, SCALEX: 1, SCALEY: 1, SCALEZ: 1, ROTX: 0, ROTY: 0, ROTZ: 0,
    MODEL, ...extra,
  });

  afterEach(() => {
    setModelBoxLookup(null);
  });

  test("プリミティブは 1×1×1（正規化された大きさ）", () => {
    const b = boundsOf(look("box"));
    expect([b.hw, b.hh, b.hd]).toEqual([0.5, 0.5, 0.5]);
    expect([b.X, b.Y, b.Z]).toEqual([0, 0, 0]);
  });

  test("プリミティブは拡大縮小が効く", () => {
    // 自分で書いた判定と違い、こちらは**見た目そのもの**なので SCALE に従う
    const b = boundsOf(look("cylinder", { SCALEX: 10, SCALEY: 2, SCALEZ: 10 }));
    expect([b.hw, b.hh, b.hd]).toEqual([5, 1, 5]);
  });

  test("見た目でも回転は効かない", () => {
    const plain = boundsOf(look("box"));
    const turned = boundsOf(look("box", { ROTY: 45, ROTX: 30, ROTZ: 90 }));
    expect(turned).toEqual(plain);
  });

  test("位置は座標のとおり", () => {
    const b = boundsOf(look("box", { X: 3, Y: -1, Z: 2 }));
    expect([b.X, b.Y, b.Z]).toEqual([3, -1, 2]);
  });

  test("3Dモデルは、モデルの外接直方体を使う", () => {
    setModelBoxLookup((name) =>
      name === "cat.glb" ? { center: [0, 1, 0], half: [0.5, 1, 0.25] } : null);
    const b = boundsOf(look("cat.glb"));
    expect([b.hw, b.hh, b.hd]).toEqual([0.5, 1, 0.25]);
    // モデルの中心がずれていれば、そのぶん判定もずれる
    expect([b.X, b.Y, b.Z]).toEqual([0, 1, 0]);
  });

  test("3Dモデルも拡大縮小が効く（中心のずれも一緒に伸びる）", () => {
    setModelBoxLookup(() => ({ center: [0, 1, 0], half: [0.5, 1, 0.25] }));
    const b = boundsOf(look("cat.glb", { X: 10, SCALEX: 2, SCALEY: 3, SCALEZ: 4 }));
    expect([b.hw, b.hh, b.hd]).toEqual([1, 3, 1]);
    expect([b.X, b.Y, b.Z]).toEqual([10, 3, 0]);
  });

  test("まだ読み込めていないモデルは、判定を持たない", () => {
    setModelBoxLookup(() => null);
    expect(boundsOf(look("cat.glb"))).toBeNull();
  });

  test("画面に出さない管理用は、判定を持たない", () => {
    // 表示していない以上、当たるものが無い
    expect(boundsOf(look("", { KIND: "NONE" }))).toBeNull();
    expect(boundsOf(look("box", { KIND: "NONE" }))).toBeNull();
    expect(boundsOf({ X: 0, Y: 0, Z: 0 })).toBeNull();
  });

  test("null や false を書けば、判定を外せる", () => {
    expect(boundsOf(look("box", { BOUNDARY: null }))).toBeNull();
    expect(boundsOf(look("box", { BOUNDARY: false }))).toBeNull();
  });

  test("自分で書いた場合は、これまでどおり拡大縮小が効かない", () => {
    const b = boundsOf(look("box", { SCALEX: 10, BOUNDARY: { SCALEX: 2 } }));
    expect(b.hw).toBe(1);
  });

  test("見た目どうしでも当たりを取れる", () => {
    const ground = look("cylinder", { Y: -0.5, SCALEX: 10, SCALEZ: 10 });
    const cat = look("box", { Y: 0 });
    expect(findHit(cat, ground)).toBe(ground);
    expect(findHit(ground, cat)).toBe(cat);
  });
});

describe("円柱の判定", () => {
  /** 円柱の判定を持つオブジェクト */
  const cylinder = (X, Y, Z, extra = {}) =>
    obj(X, Y, Z, { MODEL: "cylinder", RADIUS: 1, SCALEY: 2, ...extra });

  test("半径と高さで決まる（既定は半径0.5・高さ1）", () => {
    const b = boundsOf(obj(0, 0, 0, { MODEL: "cylinder" }));
    expect(b.shape).toBe("cylinder");
    expect(b.r).toBe(0.5);
    expect(b.hh).toBe(0.5);
    // 横幅は半径にそろえる（外接する直方体として扱えるように）
    expect([b.hw, b.hd]).toEqual([0.5, 0.5]);
  });

  test("半径と高さを指定できる", () => {
    const b = boundsOf(cylinder(0, 0, 0));
    expect([b.r, b.hh]).toEqual([1, 1]);
  });

  test("扱えない値は既定へ戻す", () => {
    const b = boundsOf(obj(0, 0, 0, { MODEL: "cylinder", RADIUS: -1, SCALEY: "たかい" }));
    expect([b.r, b.hh]).toEqual([0.5, 0.5]);
  });

  test("円柱どうしは、XZの円とYの範囲で見る", () => {
    const a = boundsOf(cylinder(0, 0, 0));
    // XZ が重なり、Y も重なる
    expect(hitBetween(a, boundsOf(cylinder(1.5, 0, 0)))).toBe(true);
    // XZ が離れている
    expect(hitBetween(a, boundsOf(cylinder(2.5, 0, 0)))).toBe(false);
    // XZ は重なるが、Y が離れている
    expect(hitBetween(a, boundsOf(cylinder(0, 3, 0)))).toBe(false);
    // 斜めでも、角ではなく距離で見る（直方体との違い）
    expect(hitBetween(a, boundsOf(cylinder(1.5, 0, 1.5)))).toBe(false);
  });

  test("円柱と直方体は、XZの円と矩形で見る", () => {
    const cylB = boundsOf(cylinder(0, 0, 0));
    const box = (X, Y, Z) => boundsOf(obj(X, Y, Z, { SCALEX: 2, SCALEY: 2, SCALEZ: 2 }));
    expect(hitBetween(cylB, box(1.5, 0, 0))).toBe(true);
    expect(hitBetween(cylB, box(2.5, 0, 0))).toBe(false);
    // 角のそば。中心どうしは遠いが、角には触れている
    expect(hitBetween(cylB, box(1.7, 0, 1.7))).toBe(true);
    // 角からも離れている
    expect(hitBetween(cylB, box(2.5, 0, 2.5))).toBe(false);
    // Y が離れていれば当たらない
    expect(hitBetween(cylB, box(0, 3, 0))).toBe(false);
    // 順番を入れ替えても同じ
    expect(hitBetween(box(1.5, 0, 0), cylB)).toBe(true);
  });

  test("円柱と球は、いちばん近い点までの距離で見る", () => {
    const cylB = boundsOf(cylinder(0, 0, 0));
    const sphere = (X, Y, Z, radius = 0.5) => boundsOf(obj(X, Y, Z, { MODEL: "sphere", radius }));
    // 真横
    expect(hitBetween(cylB, sphere(1.4, 0, 0))).toBe(true);
    expect(hitBetween(cylB, sphere(1.6, 0, 0))).toBe(false);
    // 真上
    expect(hitBetween(cylB, sphere(0, 1.4, 0))).toBe(true);
    expect(hitBetween(cylB, sphere(0, 1.6, 0))).toBe(false);
    // 上の縁のそば。横にも上にもはみ出しているので、斜めの距離で見る。
    // 縁からの距離は √((1.2-1)² + (1.2-1)²) ≈ 0.283 なので、半径0.5なら届く
    expect(hitBetween(cylB, sphere(1.2, 1.2, 0))).toBe(true);
    // √((1.5-1)² + (1.5-1)²) ≈ 0.707 なので、半径0.5では届かない
    expect(hitBetween(cylB, sphere(1.5, 1.5, 0))).toBe(false);
    // 順番を入れ替えても同じ
    expect(hitBetween(sphere(1.4, 0, 0), cylB)).toBe(true);
  });

  test("2Dでは、横から見た矩形として扱う", () => {
    const a = boundsOf(cylinder(0, 0, 0));
    // Zが離れていても、XYが重なっていれば当たり
    expect(hitBetweenXY(a, boundsOf(cylinder(1.5, 0, 100)))).toBe(true);
    // 幅は半径ぶん、高さは指定どおり
    expect(hitBetweenXY(a, boundsOf(obj(2.1, 0, 0, { SCALEX: 0.2 })))).toBe(false);
    expect(hitBetweenXY(a, boundsOf(obj(0, 1.2, 0, { SCALEY: 0.2 })))).toBe(false);
    expect(hitBetweenXY(a, boundsOf(obj(0, 1.05, 0, { SCALEY: 0.2 })))).toBe(true);
  });
});

describe("@RADIUS は当たり判定にも効く", () => {
  test("@BOUNDARY を書かなければ、見た目どおりの大きさになる", () => {
    // 元の形は半径0.5。@RADIUS = 2 なら、中心から端まで 2
    const b = boundsOf({ MODEL: "sphere", KIND: "PRIM", RADIUS: 2, X: 0, Y: 0, Z: 0 });
    expect(b.hw).toBeCloseTo(2, 6);
    expect(b.hh).toBeCloseTo(2, 6);
    expect(b.hd).toBeCloseTo(2, 6);
  });

  test("円柱は太さだけが変わり、高さは @SCALEY のまま", () => {
    const b = boundsOf({
      MODEL: "cylinder", KIND: "PRIM", RADIUS: 1, SCALEY: 6, X: 0, Y: 0, Z: 0,
    });
    expect(b.hw).toBeCloseTo(1, 6);
    expect(b.hh).toBeCloseTo(3, 6);
    expect(b.hd).toBeCloseTo(1, 6);
  });

  test("@BOUNDARY を書いた場合は、これまでどおり @RADIUS に影響されない", () => {
    // 自分で書いた判定は見た目と切り離す（5.5節）
    const b = boundsOf({
      MODEL: "sphere", KIND: "PRIM", RADIUS: 10, X: 0, Y: 0, Z: 0,
      BOUNDARY: { MODEL: "sphere", RADIUS: 0.5 },
    });
    expect(b.r).toBeCloseTo(0.5, 6);
  });
});

describe("@BOUNDARY のキーは大文字", () => {
  const at = (extra) => ({ MODEL: "box", KIND: "PRIM", X: 0, Y: 0, Z: 0, BOUNDARY: extra });

  test("形は MODEL で指定する", () => {
    // インスタンスのプロパティ @MODEL と同じ言葉にする
    expect(boundsOf(at({ MODEL: "sphere", RADIUS: 2 })).shape).toBe("sphere");
    expect(boundsOf(at({ MODEL: "cylinder", RADIUS: 1 })).shape).toBe("cylinder");
  });

  test("大きさは SCALEX / SCALEY / SCALEZ", () => {
    const b = boundsOf(at({ MODEL: "box", SCALEX: 4, SCALEY: 2, SCALEZ: 6 }));
    expect([b.hw, b.hh, b.hd]).toEqual([2, 1, 3]);
  });

  test("丸い形の太さは RADIUS", () => {
    expect(boundsOf(at({ MODEL: "sphere", RADIUS: 3 })).r).toBe(3);
  });

  test("ずれは X / Y / Z", () => {
    const b = boundsOf({ MODEL: "box", KIND: "PRIM", X: 10, Y: 20, Z: 30,
                         BOUNDARY: { MODEL: "box", X: 1, Y: -2, Z: 0.5 } });
    expect([b.X, b.Y, b.Z]).toEqual([11, 18, 30.5]);
  });

  test("小文字で書いても効かない", () => {
    // 書き方は1つに絞る。紛れがあると、どちらが効くのか分からなくなる
    const b = boundsOf({ MODEL: "box", KIND: "PRIM", X: 0, Y: 0, Z: 0,
                         BOUNDARY: { shape: "sphere", radius: 9, width: 8, offsetX: 7 } });
    expect(b.shape).toBe("box");
    expect(b.r).toBe(0.5);
    expect(b.hw).toBe(0.5);
    expect(b.X).toBe(0);
  });

  test("円柱は RADIUS が横幅になる", () => {
    const b = boundsOf(at({ MODEL: "cylinder", RADIUS: 2, SCALEY: 10 }));
    expect([b.hw, b.hd]).toEqual([2, 2]);
    expect(b.hh).toBe(5);
  });

  test("知らない形は直方体として扱う", () => {
    expect(boundsOf(at({ MODEL: "torus" })).shape).toBe("box");
  });
});

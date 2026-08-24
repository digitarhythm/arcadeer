// 当たり判定（仕様書5.5節）
//
// **既定では見た目どおりに当たり、必要なときだけ切り離せる。**
//
// | `@BOUNDARY` | 判定 | 拡大縮小 |
// | --- | --- | --- |
// | 書かない | 見た目そのもの | **効く** |
// | `null` / `false` | 持たない | ― |
// | オブジェクト | 書いた形 | **効かない** |
//
// ```coffee
// @BOUNDARY =
//   shape: "box"      # "box"（直方体）/ "sphere"（球）/ "cylinder"（円柱）
//   width:  1
//   height: 1
//   depth:  1
//   radius: 0.5       # shape: "sphere" / "cylinder" のとき
//   offsetX: 0        # オブジェクトの位置からのずれ
//   offsetY: 0
//   offsetZ: 0
// ```
//
// 自分で書いた判定に拡大縮小が効かないのは、**見た目と切り離す**ためである。
// もの凄く大きな見た目に、ごく小さな判定を付けられる。難易度の調整はここで行う。
//
// **回転（@ROT）はどちらの場合も効かない。**軸に沿った形だけを扱うほうが速く、
// 調整もしやすいため。
//
// 画面にもWebGLにも依存しないため単体テストできる。

import { KIND_2D, KIND_3D, KIND_PRIMITIVE, resolveKind } from "./kind.js";

/** 指定できる形 */
const SHAPES = ["box", "sphere", "cylinder"];

/** 大きさの既定値（全長） */
const DEFAULT_SIZE = 1;
/** 球の半径の既定値 */
const DEFAULT_RADIUS = 0.5;

/** 正の数として読む。読めなければ既定値 */
function 正の数(value, 既定) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 既定;
}

/** 数として読む。読めなければ 0 */
function 数(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 3Dモデルの外接直方体を引く関数
 *
 * モデルの中身は renderer.js が持つため、外から差し込んでもらう。
 * ここへ WebGL の依存を持ち込まないようにするため。
 */
let modelBoxLookup = null;

/** モデルの外接直方体を引く関数を差し込む（null で解除） */
export function setModelBoxLookup(fn) {
  modelBoxLookup = typeof fn === "function" ? fn : null;
}

/**
 * 見た目そのものを判定にする
 *
 * `@BOUNDARY` を書かなかった場合に使う。**こちらは拡大縮小が効く。**
 * 見えているものがそのまま当たるのが自然だからで、
 * 自分で書いた判定（見た目と切り離したいもの）とは扱いが逆になる。
 *
 * 画面に出さないもの（管理用）は、当たるものが無いので判定を持たない。
 */
function 見た目の判定(object) {
  const kind = resolveKind(object);

  // どの形も原点中心の 1×1×1 に正規化されている（6.2.5節）
  if (kind === KIND_PRIMITIVE || kind === KIND_2D) {
    return { center: [0, 0, 0], half: [0.5, 0.5, 0.5] };
  }

  if (kind === KIND_3D) {
    // まだ読み込めていないモデルは、大きさが分からないので判定を持たない
    const box = modelBoxLookup?.(object.MODEL) ?? null;
    if (!box) return null;
    return box;
  }

  return null;
}

/**
 * そのオブジェクトの当たり判定を求める
 *
 * `@BOUNDARY` の書き方で3通りに分かれる。
 *
 * | 値 | 意味 |
 * | --- | --- |
 * | 書かない | **見た目そのものが判定**（拡大縮小が効く） |
 * | `null` / `false` | 判定なし（明示的に外す） |
 * | オブジェクト | 書いた形が判定（拡大縮小は効かない） |
 *
 * @returns 中心と半径ぶんの大きさ。判定を持たない場合は null
 */
export function boundsOf(object) {
  if (!object) return null;
  const c = object.BOUNDARY;

  // 書かなかった場合は、見えているものをそのまま判定にする
  if (c === undefined) {
    const 見た目 = 見た目の判定(object);
    if (!見た目) return null;
    const sx = 正の数(object.SCALEX, 1);
    const sy = 正の数(object.SCALEY, 1);
    const sz = 正の数(object.SCALEZ, 1);
    return {
      shape: "box",
      X: 数(object.X) + 見た目.center[0] * sx,
      Y: 数(object.Y) + 見た目.center[1] * sy,
      Z: 数(object.Z) + 見た目.center[2] * sz,
      hw: 見た目.half[0] * sx,
      hh: 見た目.half[1] * sy,
      hd: 見た目.half[2] * sz,
      r: Math.max(見た目.half[0] * sx, 見た目.half[1] * sy, 見た目.half[2] * sz),
    };
  }

  if (!c || typeof c !== "object") return null;

  const shape = SHAPES.includes(c.shape) ? c.shape : "box";
  const r = 正の数(c.radius, DEFAULT_RADIUS);
  const 円柱 = shape === "cylinder";
  return {
    shape,
    // 位置はオブジェクトの座標にずれを足したもの
    X: 数(object.X) + 数(c.offsetX),
    Y: 数(object.Y) + 数(c.offsetY),
    Z: 数(object.Z) + 数(c.offsetZ),
    // 直方体は「中心から端まで」で持つ。当たりを見る時に扱いやすい。
    // 円柱の横幅は半径にそろえ、外接する直方体としても使えるようにする
    hw: 円柱 ? r : 正の数(c.width, DEFAULT_SIZE) / 2,
    hh: 正の数(c.height, DEFAULT_SIZE) / 2,
    hd: 円柱 ? r : 正の数(c.depth, DEFAULT_SIZE) / 2,
    r,
  };
}

/** 直方体どうし。**接している場合も当たり**とみなす */
function 箱と箱(a, b) {
  return (
    Math.abs(a.X - b.X) <= a.hw + b.hw &&
    Math.abs(a.Y - b.Y) <= a.hh + b.hh &&
    Math.abs(a.Z - b.Z) <= a.hd + b.hd
  );
}

/** 球どうし。中心の距離で見る */
function 球と球(a, b) {
  const dx = a.X - b.X;
  const dy = a.Y - b.Y;
  const dz = a.Z - b.Z;
  const 和 = a.r + b.r;
  return dx * dx + dy * dy + dz * dz <= 和 * 和;
}

/** その範囲の中で、いちばん近い値へ寄せる */
function 寄せる(値, 中心, 半分) {
  return Math.min(Math.max(値, 中心 - 半分), 中心 + 半分);
}

/** 球と直方体。直方体の中でいちばん近い点までの距離で見る */
function 球と箱(球, 箱) {
  const dx = 球.X - 寄せる(球.X, 箱.X, 箱.hw);
  const dy = 球.Y - 寄せる(球.Y, 箱.Y, 箱.hh);
  const dz = 球.Z - 寄せる(球.Z, 箱.Z, 箱.hd);
  return dx * dx + dy * dy + dz * dz <= 球.r * 球.r;
}

/**
 * Y方向の重なり
 *
 * 直方体も円柱も「XZ平面の形を、Y方向へ押し出したもの」なので、
 * **XZの重なり × Yの重なり**に分けて考えられる。
 */
function 高さが重なる(a, b) {
  return Math.abs(a.Y - b.Y) <= a.hh + b.hh;
}

/** 円柱どうし。XZは円と円で見る */
function 柱と柱(a, b) {
  if (!高さが重なる(a, b)) return false;
  const dx = a.X - b.X;
  const dz = a.Z - b.Z;
  const 和 = a.r + b.r;
  return dx * dx + dz * dz <= 和 * 和;
}

/** 円柱と直方体。XZは円と矩形で見る */
function 柱と箱(柱, 箱) {
  if (!高さが重なる(柱, 箱)) return false;
  const dx = 柱.X - 寄せる(柱.X, 箱.X, 箱.hw);
  const dz = 柱.Z - 寄せる(柱.Z, 箱.Z, 箱.hd);
  return dx * dx + dz * dz <= 柱.r * 柱.r;
}

/**
 * 円柱と球。円柱の中でいちばん近い点までの距離で見る
 *
 * 横のはみ出しと上下のはみ出しを別々に求めて合わせる。
 * 縁（角）に触れている場合も、これで正しく拾える。
 */
function 柱と球(柱, 球) {
  const 横 = Math.hypot(球.X - 柱.X, 球.Z - 柱.Z);
  const dr = Math.max(0, 横 - 柱.r);
  const dv = Math.max(0, Math.abs(球.Y - 柱.Y) - 柱.hh);
  return dr * dr + dv * dv <= 球.r * 球.r;
}

/**
 * 2つの判定が当たっているか（XYZ すべてを見る）
 *
 * どちらかが判定を持たない場合は当たらない。
 */
export function hitBetween(a, b) {
  if (!a || !b) return false;

  const 球a = a.shape === "sphere";
  const 球b = b.shape === "sphere";
  const 柱a = a.shape === "cylinder";
  const 柱b = b.shape === "cylinder";

  if (柱a && 柱b) return 柱と柱(a, b);
  if (柱a && 球b) return 柱と球(a, b);
  if (柱b && 球a) return 柱と球(b, a);
  if (柱a) return 柱と箱(a, b);
  if (柱b) return 柱と箱(b, a);

  if (球a && 球b) return 球と球(a, b);
  if (球a) return 球と箱(a, b);
  if (球b) return 球と箱(b, a);
  return 箱と箱(a, b);
}

/**
 * 奥行きを持たない形にする（Zを潰し、直方体の奥行きは無限にする）
 *
 * 円柱はY方向へ押し出した形なので、**真横から見ると矩形**になる。
 */
function 平面にする(b) {
  if (b.shape === "cylinder") return { ...b, shape: "box", hw: b.r, hd: Infinity, Z: 0 };
  return { ...b, Z: 0, hd: Infinity };
}

/**
 * 2つの判定が当たっているか（**XY平面だけ**を見る）
 *
 * 見下ろし型や横スクロールのように、奥行きを気にしない遊びのために使う。
 * 球は円として、直方体は矩形として扱われる。
 */
export function hitBetweenXY(a, b) {
  if (!a || !b) return false;
  return hitBetween(平面にする(a), 平面にする(b));
}

/**
 * 相手を指定して、当たっているかを調べる
 *
 * **呼んだ瞬間の位置**で判断するため、動かした直後に聞いて、
 * その場で戻す、という書き方ができる。
 *
 * @param self 自分
 * @param target 相手（1つ、または配列）
 * @param mode `"2d"` なら奥行きを見ない
 * @returns 当たった相手。当たっていなければ null
 */
export function findHit(self, target, mode) {
  const 自分 = boundsOf(self);
  if (!自分) return null;

  const 当たる = mode === "2d" ? hitBetweenXY : hitBetween;
  const 相手たち = Array.isArray(target) ? target : [target];
  for (const 相手 of 相手たち) {
    // 自分自身は当たらない。判定を持たない相手は飛ばす
    if (!相手 || 相手 === self) continue;
    if (当たる(自分, boundsOf(相手))) return 相手;
  }
  return null;
}

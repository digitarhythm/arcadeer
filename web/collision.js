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
function toPositive(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 数として読む。読めなければ 0 */
function toNumber(value) {
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
function lookBounds(object) {
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
    const look = lookBounds(object);
    if (!look) return null;
    const sx = toPositive(object.SCALEX, 1);
    const sy = toPositive(object.SCALEY, 1);
    const sz = toPositive(object.SCALEZ, 1);
    return {
      shape: "box",
      X: toNumber(object.X) + look.center[0] * sx,
      Y: toNumber(object.Y) + look.center[1] * sy,
      Z: toNumber(object.Z) + look.center[2] * sz,
      hw: look.half[0] * sx,
      hh: look.half[1] * sy,
      hd: look.half[2] * sz,
      r: Math.max(look.half[0] * sx, look.half[1] * sy, look.half[2] * sz),
    };
  }

  if (!c || typeof c !== "object") return null;

  const shape = SHAPES.includes(c.shape) ? c.shape : "box";
  const r = toPositive(c.radius, DEFAULT_RADIUS);
  const isCylinder = shape === "cylinder";
  return {
    shape,
    // 位置はオブジェクトの座標にずれを足したもの
    X: toNumber(object.X) + toNumber(c.offsetX),
    Y: toNumber(object.Y) + toNumber(c.offsetY),
    Z: toNumber(object.Z) + toNumber(c.offsetZ),
    // 直方体は「中心から端まで」で持つ。当たりを見る時に扱いやすい。
    // 円柱の横幅は半径にそろえ、外接する直方体としても使えるようにする
    hw: isCylinder ? r : toPositive(c.width, DEFAULT_SIZE) / 2,
    hh: toPositive(c.height, DEFAULT_SIZE) / 2,
    hd: isCylinder ? r : toPositive(c.depth, DEFAULT_SIZE) / 2,
    r,
  };
}

/** 直方体どうし。**接している場合も当たり**とみなす */
function boxVsBox(a, b) {
  return (
    Math.abs(a.X - b.X) <= a.hw + b.hw &&
    Math.abs(a.Y - b.Y) <= a.hh + b.hh &&
    Math.abs(a.Z - b.Z) <= a.hd + b.hd
  );
}

/** 球どうし。中心の距離で見る */
function sphereVsSphere(a, b) {
  const dx = a.X - b.X;
  const dy = a.Y - b.Y;
  const dz = a.Z - b.Z;
  const sum = a.r + b.r;
  return dx * dx + dy * dy + dz * dz <= sum * sum;
}

/** その範囲の中で、いちばん近い値へ寄せる */
function clampTo(value, center, half) {
  return Math.min(Math.max(value, center - half), center + half);
}

/** 球と直方体。直方体の中でいちばん近い点までの距離で見る */
function sphereVsBox(sphere, box) {
  const dx = sphere.X - clampTo(sphere.X, box.X, box.hw);
  const dy = sphere.Y - clampTo(sphere.Y, box.Y, box.hh);
  const dz = sphere.Z - clampTo(sphere.Z, box.Z, box.hd);
  return dx * dx + dy * dy + dz * dz <= sphere.r * sphere.r;
}

/**
 * Y方向の重なり
 *
 * 直方体も円柱も「XZ平面の形を、Y方向へ押し出したもの」なので、
 * **XZの重なり × Yの重なり**に分けて考えられる。
 */
function heightOverlaps(a, b) {
  return Math.abs(a.Y - b.Y) <= a.hh + b.hh;
}

/** 円柱どうし。XZは円と円で見る */
function cylVsCyl(a, b) {
  if (!heightOverlaps(a, b)) return false;
  const dx = a.X - b.X;
  const dz = a.Z - b.Z;
  const sum = a.r + b.r;
  return dx * dx + dz * dz <= sum * sum;
}

/** 円柱と直方体。XZは円と矩形で見る */
function cylVsBox(cylinder, box) {
  if (!heightOverlaps(cylinder, box)) return false;
  const dx = cylinder.X - clampTo(cylinder.X, box.X, box.hw);
  const dz = cylinder.Z - clampTo(cylinder.Z, box.Z, box.hd);
  return dx * dx + dz * dz <= cylinder.r * cylinder.r;
}

/**
 * 円柱と球。円柱の中でいちばん近い点までの距離で見る
 *
 * 横のはみ出しと上下のはみ出しを別々に求めて合わせる。
 * 縁（角）に触れている場合も、これで正しく拾える。
 */
function cylVsSphere(cylinder, sphere) {
  const radial = Math.hypot(sphere.X - cylinder.X, sphere.Z - cylinder.Z);
  const dr = Math.max(0, radial - cylinder.r);
  const dv = Math.max(0, Math.abs(sphere.Y - cylinder.Y) - cylinder.hh);
  return dr * dr + dv * dv <= sphere.r * sphere.r;
}

/**
 * 2つの判定が当たっているか（XYZ すべてを見る）
 *
 * どちらかが判定を持たない場合は当たらない。
 */
export function hitBetween(a, b) {
  if (!a || !b) return false;

  const sphereA = a.shape === "sphere";
  const sphereB = b.shape === "sphere";
  const cylA = a.shape === "cylinder";
  const cylB = b.shape === "cylinder";

  if (cylA && cylB) return cylVsCyl(a, b);
  if (cylA && sphereB) return cylVsSphere(a, b);
  if (cylB && sphereA) return cylVsSphere(b, a);
  if (cylA) return cylVsBox(a, b);
  if (cylB) return cylVsBox(b, a);

  if (sphereA && sphereB) return sphereVsSphere(a, b);
  if (sphereA) return sphereVsBox(a, b);
  if (sphereB) return sphereVsBox(b, a);
  return boxVsBox(a, b);
}

/**
 * 奥行きを持たない形にする（Zを潰し、直方体の奥行きは無限にする）
 *
 * 円柱はY方向へ押し出した形なので、**真横から見ると矩形**になる。
 */
function flatten(b) {
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
  return hitBetween(flatten(a), flatten(b));
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
  const mine = boundsOf(self);
  if (!mine) return null;

  const overlaps = mode === "2d" ? hitBetweenXY : hitBetween;
  const targets = Array.isArray(target) ? target : [target];
  for (const other of targets) {
    // 自分自身は当たらない。判定を持たない相手は飛ばす
    if (!other || other === self) continue;
    if (overlaps(mine, boundsOf(other))) return other;
  }
  return null;
}

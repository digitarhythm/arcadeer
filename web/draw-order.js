// 半透明を正しく描くための並べ替え（仕様書6.2.5節）
//
// 半透明は「先に描いたものの上へ重ねる」形で色を混ぜるため、**描く順が結果を変える**。
// 奥から手前へ描かないと、手前の半透明ごしに奥のものが見えなくなる。
//
// 不透明なものは深度テストに任せられるので、並べ替える必要はない。
// そのため「不透明 → 半透明（奥から手前）」の2組に分ける。
//
// WebGLに依存しないため単体テストできる。

import { normalizeAlpha, parseColor } from "./color.js";

/**
 * 半透明かどうか
 *
 * `@ALPHA` と `@COLOR` の8桁指定の、どちらかが透けていれば半透明として扱う。
 */
export function isTransparent(object) {
  if (normalizeAlpha(object?.ALPHA) < 1) return true;
  return object?.COLOR ? parseColor(object.COLOR)[3] < 1 : false;
}

/** カメラからオブジェクトまでの距離（比べるだけなので平方根は取らない） */
function distanceSquared(object, camera) {
  const dx = (object?.X ?? 0) - (camera?.X ?? 0);
  const dy = (object?.Y ?? 0) - (camera?.Y ?? 0);
  const dz = (object?.Z ?? 0) - (camera?.Z ?? 0);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * 描く順に2組へ分ける
 *
 * 半透明は**カメラから遠いものを先に**並べる。距離が同じものは、
 * もとの順を保つ（毎フレーム入れ替わると、ちらついて見えるため）。
 *
 * @returns `{ opaque, transparent }`
 */
export function splitByAlpha(objects, camera) {
  const opaque = [];
  const transparent = [];
  for (const object of objects ?? []) {
    (isTransparent(object) ? transparent : opaque).push(object);
  }

  // 距離を先に求めておく。並べ替えのたびに計算し直さないため
  const distances = new Map();
  for (const object of transparent) distances.set(object, distanceSquared(object, camera));
  transparent.sort((a, b) => distances.get(b) - distances.get(a));

  return { opaque, transparent };
}

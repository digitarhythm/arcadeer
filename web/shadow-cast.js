// 半透明のものが落とす影（仕様書6.2.6節）
//
// 影は深度マップ1枚で作っており、そこに書けるのは深度だけで
// 「どれだけ光を通したか」を持たない。そのため、そのままでは
// 半透明のものも真っ黒な影を落としてしまう。
//
// そこで**透過率マップ**をもう1枚用意し、
//
// - 深度マップには**不透明なものだけ**を描く
// - 透過率マップを白（＝全部通す）で塗り、半透明なものを `1 - ALPHA` の色で描く
// - 掛け算のブレンドにしておく（重なれば自然に濃くなる。描く順を気にしなくてよい）
//
// という形にする。ここは、その分け方と値の決め方だけを受け持つ。
// WebGLに依存しないため単体テストできる。

import { normalizeAlpha, parseColor } from "./color.js";
import { isTransparent } from "./draw-order.js";

/**
 * 影を落とす側を、不透明と半透明に分ける
 *
 * `@SHADOW = false` のものは**どちらにも入れない**。
 * 深度にも透過率にも関わらせないことで、影そのものを消す。
 *
 * @returns `{ solid, translucent }`
 */
export function splitCasters(objects) {
  const solid = [];
  const translucent = [];
  for (const object of objects ?? []) {
    if (object?.SHADOW === false) continue;
    (isTransparent(object) ? translucent : solid).push(object);
  }
  return { solid, translucent };
}

/**
 * そのオブジェクトが光をどれだけ通すか（0〜1）
 *
 * 見た目の濃さと影の濃さを合わせるため、`@ALPHA` と `@COLOR` の
 * 8桁指定を掛け合わせた透明度の、裏返しを返す。
 */
export function transmittanceOf(object) {
  const fromColor = object?.COLOR ? parseColor(object.COLOR)[3] : 1;
  return 1 - fromColor * normalizeAlpha(object?.ALPHA);
}

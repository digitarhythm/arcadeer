// 描画対象の選別と配置の計算
//
// WebGLに依存しないため単体テストできる。実際の描画は renderer.js が行う。

import { multiply, translation, scaling, rotationX, rotationY, rotationZ } from "./matrix.js";
import { isPrimitiveName } from "./primitive.js";
import { KIND_NONE, KIND_PRIMITIVE, KIND_2D, KIND_3D, resolveKind } from "./kind.js";

/** 3Dモデルとして扱う拡張子 */
const MODEL_EXTS = [".glb", ".gltf"];

// 種別の番号は kind.js が持つ。ここからも使えるように通す
export { KIND_NONE, KIND_PRIMITIVE, KIND_2D, KIND_3D };

/** 数値として扱えない値は既定値にする */
function num(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 度からラジアンへ */
function rad(degrees) {
  return (num(degrees) * Math.PI) / 180;
}

/**
 * 3Dモデルの描画対象かどうか
 *
 * 種別が3D（`@KIND = "3D"`）で、`@MODEL` に3Dモデルのファイル名が入っているものだけを描く。
 * 組み込みプリミティブや画像は対象外。`@KIND` の指定が無い場合は `@MODEL` から判断する。
 */
export function isRenderable3D(object) {
  if (!object || resolveKind(object) !== KIND_3D) return false;
  const model = object.MODEL;
  if (typeof model !== "string" || model === "") return false;
  const lower = model.toLowerCase();
  return MODEL_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * 組み込みプリミティブの描画対象かどうか
 *
 * 種別がプリミティブ（`@KIND = "PRIM"`）で、`@MODEL` に形状名（`"box"` など）が入っているもの。
 * `@KIND` の指定が無い場合は `@MODEL` から判断する。
 */
export function isPrimitive(object) {
  if (!object || resolveKind(object) !== KIND_PRIMITIVE) return false;
  return isPrimitiveName(object.MODEL);
}

/**
 * オブジェクトの座標・回転・拡大率から配置行列を作る
 *
 * 拡大縮小 → 回転（**Z → X → Y** の順）→ 平行移動 の順に効く。
 * 回転は扱いやすさを優先して**度**で指定する。
 */
/** 丸いプリミティブ。@RADIUS が効くもの */
const ROUND_SHAPES = ["sphere", "cylinder", "cone"];

/** 正の有限数だけを通す（それ以外は「書かなかった」ものとして扱う） */
function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * そのオブジェクトの実際の拡大率（仕様書6.2.5節）
 *
 * 丸いプリミティブは `@RADIUS` で太さを指定できる。**書けば `@SCALE` より優先する**。
 * 掛け合わせないのは、`@RADIUS = 1` と書いたのに `@SCALEX = 2` が残っていて
 * 半径2になる、という分かりにくさを避けるため。
 *
 * ```coffee
 * @MODEL = "sphere"
 * @RADIUS = 0.25      # 3軸を書かなくてよい
 *
 * @MODEL = "cylinder"
 * @RADIUS = 1         # 太さ
 * @SCALEY = 3         # 高さは @SCALEY のまま
 * ```
 *
 * 元の形はどれも原点中心の 1×1×1（半径0.5）なので、**倍率は `@RADIUS` の2倍**になる。
 *
 * 描画と当たり判定の両方がここを通る。別々に書くと必ずずれるため。
 *
 * @returns `[x, y, z]` の倍率
 */
export function effectiveScale(object) {
  const scale = [
    num(object?.SCALEX, 1),
    num(object?.SCALEY, 1),
    num(object?.SCALEZ, 1),
  ];

  const radius = positive(object?.RADIUS);
  if (radius === null) return scale;
  // 組み込みプリミティブのうち、丸いものだけが対象
  const shape = typeof object?.MODEL === "string" ? object.MODEL.toLowerCase() : "";
  if (!ROUND_SHAPES.includes(shape) || !isPrimitive(object)) return scale;

  const width = radius * 2;
  // 球は3軸とも。円柱と円錐は太さ（X・Z）だけで、高さは @SCALEY のまま
  return shape === "sphere" ? [width, width, width] : [width, scale[1], width];
}

export function modelMatrix(object) {
  const scale = scaling(...effectiveScale(object));
  const rotation = multiply(
    rotationY(rad(object?.ROTY)),
    multiply(rotationX(rad(object?.ROTX)), rotationZ(rad(object?.ROTZ))),
  );
  return multiply(
    translation(num(object?.X), num(object?.Y), num(object?.Z)),
    multiply(rotation, scale),
  );
}

/** 描画対象が使っているモデル名を、重複を除いて集める */
export function modelsUsedBy(objects) {
  const names = new Set();
  for (const object of objects ?? []) {
    if (isRenderable3D(object)) names.add(object.MODEL);
  }
  return [...names];
}

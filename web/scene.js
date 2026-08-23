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
export function modelMatrix(object) {
  const scale = scaling(
    num(object?.SCALEX, 1),
    num(object?.SCALEY, 1),
    num(object?.SCALEZ, 1),
  );
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

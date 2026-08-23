// オブジェクトの種別（@KIND）の解釈と自動判定（仕様書6.2.5節）
//
// 種別は名前（"NONE" / "PRIM" / "2D" / "3D"）でも数値でも指定できる。
// 指定が無い場合は `@MODEL` の内容から自動で決める。
//
// `@KIND` と `@MODEL` は `super(param)` の**後**にコンストラクタ本体で
// 代入されることが多いため、生成時ではなく**描画のたびに解決する**。

import { pushLog } from "./console-log.js";
import { isPrimitiveName } from "./primitive.js";

/**
 * 種別の番号
 *
 * `KIND_NONE` は**画面に出ない管理用**。`gameMain` のように、
 * 見た目を持たず処理だけを担うオブジェクトに使う。
 */
export const KIND_NONE = 0;
export const KIND_PRIMITIVE = 1;
export const KIND_2D = 2;
export const KIND_3D = 3;

/** 指定に使える名前（番号の並びと対応させる） */
export const KIND_NAMES = ["NONE", "PRIM", "2D", "3D"];

/** 3Dモデルとして扱う拡張子 */
const MODEL_EXTS = [".glb", ".gltf"];
/** 2Dの絵として扱う拡張子 */
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];

/** 一度知らせた指定を覚えておく（毎フレーム同じ警告を出さないため） */
const warned = new Set();

/**
 * `@KIND` の指定を番号にする
 *
 * @returns 番号。指定が無い場合と、知らない値の場合は `null`
 */
export function normalizeKind(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value < KIND_NAMES.length ? value : null;
  }
  if (typeof value !== "string") return null;

  const text = value.trim().toUpperCase();
  if (text === "") return null;
  const index = KIND_NAMES.indexOf(text);
  return index >= 0 ? index : null;
}

/** 末尾がいずれかの拡張子か */
function hasExt(name, exts) {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

/**
 * `@MODEL` の内容から種別を推し量る
 *
 * @returns 番号。判断できなければ `null`
 */
export function inferKind(model) {
  if (typeof model !== "string" || model === "") return null;
  if (isPrimitiveName(model)) return KIND_PRIMITIVE;
  if (hasExt(model, MODEL_EXTS)) return KIND_3D;
  if (hasExt(model, IMAGE_EXTS)) return KIND_2D;
  return null;
}

/**
 * オブジェクトの種別を決める
 *
 * 1. `@KIND` の指定があればそれに従う（`@MODEL` と食い違っていても指定を優先する）
 * 2. 指定が無ければ `@MODEL` から決める
 * 3. どちらからも決まらなければ**管理用**（画面に出さない）として扱う
 *
 * 知らない値が指定された場合は、**同じ値につき一度だけ**コンソールへ知らせる。
 */
export function resolveKind(object) {
  const specified = object?.KIND;
  const kind = normalizeKind(specified);
  if (kind !== null) return kind;

  // 「指定が無い」のは自動判定を使う正常な書き方。知らせるのは値が読めなかった場合だけ
  const omitted = specified === undefined || specified === null || specified === "";
  if (!omitted) {
    const key = String(specified);
    if (!warned.has(key)) {
      warned.add(key);
      pushLog(`@KIND: unknown value "${key}" (use ${KIND_NAMES.join(" / ")})`);
    }
  }

  return inferKind(object?.MODEL) ?? KIND_NONE;
}

/** 知らせた記録を消す（ゲームの実行開始時とテストで使う） */
export function resetKindWarnings() {
  warned.clear();
}

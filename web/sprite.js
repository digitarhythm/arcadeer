// 2Dスプライト（アニメパターン画像）の決まり（仕様書5.2 / 6.2.11節）
//
// WebGL に依存しない計算だけを置く。実際の描画は renderer.js が行う。
//
// - `@MODEL` に画像ファイルを書くと2Dキャラクターになる
// - `size` で正方形のコマの大きさ（ピクセル）を決め、画像の左上から
//   右へ、行が終わったら次の段へ 0, 1, 2 … と番号を振る
// - `pattern` はコマ番号の並びで、`anim` で何番目のパターンを見せるかを選ぶ
// - 画面は**左上が原点で、Yは下向き**。1コマ1ピクセルがそのまま画面のピクセルになる

import { orthographic } from "./matrix.js";
import { KIND_2D, resolveKind } from "./kind.js";

/** コマ送りの既定の速さ（フレーム数）。60fps なら1秒に10コマ */
export const DEFAULT_INTERVAL = 6;

/** `setPlane` を呼ばなかった時のプレーン。3Dの下に1枚（-1）、上に1枚（0） */
export const DEFAULT_PLANES = Object.freeze([-1, 0]);

/** 片側に作れるプレーンの上限。誤って巨大な数を書いても動き続けるようにするため */
export const MAX_PLANES_PER_SIDE = 16;

/** 画像として扱う拡張子 */
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];

/** 数値として扱えない値は既定値にする */
function num(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 0以上の整数だけを通す */
function cellIndex(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * 画像を指す2Dオブジェクトか
 *
 * 種別が2D（`@KIND = "2D"`、または `@MODEL` の拡張子から自動判定）で、
 * `@MODEL` に画像ファイル名が入っているもの。
 */
export function isSprite(object) {
  if (!object || resolveKind(object) !== KIND_2D) return false;
  const model = object.MODEL;
  if (typeof model !== "string" || model === "") return false;
  const lower = model.toLowerCase();
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * `pattern` の書き方をそろえる
 *
 * 2通りの書き方を受け付ける。
 *
 * ```coffee
 * pattern: [[0], [1, 2, 3, 2, 1], [4, 5]]                 # 速さは既定
 * pattern: [{ cells: [0], interval: 30 }, { cells: [1, 2, 3, 2, 1], interval: 6 }]
 * ```
 *
 * 読めない番号は落とし、空になったパターンは捨てる。
 * `interval` が読めない・1未満なら既定の速さにする。
 *
 * @returns `[{ cells, interval }]`。配列でなければ空
 */
export function normalizePattern(pattern) {
  if (!Array.isArray(pattern)) return [];
  const out = [];
  for (const entry of pattern) {
    const rawCells = Array.isArray(entry) ? entry : entry?.cells;
    if (!Array.isArray(rawCells)) continue;
    const cells = rawCells.map(cellIndex).filter((c) => c !== null);
    if (cells.length === 0) continue;

    const interval = Array.isArray(entry) ? DEFAULT_INTERVAL : Math.floor(num(entry.interval));
    out.push({ cells, interval: interval >= 1 ? interval : DEFAULT_INTERVAL });
  }
  return out;
}

/**
 * コマ番号から、画像の中の位置を求める
 *
 * 画像の左上から右へ数え、行が終わったら次の段へ移る。
 * 割り切れない端数の部分は使わない。
 *
 * @returns `{ x, y, w, h }`（ピクセル）。収まらない番号や使えない大きさなら null
 */
export function cellRect(index, size, imageWidth, imageHeight) {
  const cell = cellIndex(index);
  if (cell === null || !(size >= 1) || !(imageWidth >= 1) || !(imageHeight >= 1)) return null;

  const columns = Math.floor(imageWidth / size);
  const rows = Math.floor(imageHeight / size);
  if (columns < 1 || cell >= columns * rows) return null;

  return {
    x: (cell % columns) * size,
    y: Math.floor(cell / columns) * size,
    w: size,
    h: size,
  };
}

/** コマ送りの状態の初期値 */
export function createSpriteState() {
  return { anim: 0, step: 0, frames: 0 };
}

/**
 * コマ送りを1フレームぶん進める
 *
 * `@ANIM` が前回と違えば、そのパターンの先頭から始め直す。
 * 元の状態は書き換えず、新しい状態を返す。
 *
 * @param state 前回の状態
 * @param patterns `normalizePattern` を通したパターン
 * @param anim いま指定されているパターン番号（`@ANIM`）
 */
export function advanceSprite(state, patterns, anim) {
  const current = state ?? createSpriteState();
  if (anim !== current.anim) return { anim, step: 0, frames: 0 };

  const pattern = patterns?.[anim];
  if (!pattern) return { ...current };

  const frames = current.frames + 1;
  if (frames < pattern.interval) return { ...current, frames };
  return { anim, step: (current.step + 1) % pattern.cells.length, frames: 0 };
}

/**
 * いま見せるコマ番号
 *
 * @returns 番号。無いパターンを指している時は null
 */
export function currentCell(state, patterns) {
  const pattern = patterns?.[state?.anim];
  if (!pattern || pattern.cells.length === 0) return null;
  return pattern.cells[state.step % pattern.cells.length];
}

/**
 * コマの位置をテクスチャ座標にする
 *
 * 画像をそのまま載せるので、**画像の左上が (0, 0)、右下が (1, 1)**。
 *
 * @returns `[u0, v0, u1, v1]`
 */
export function spriteUv(rect, imageWidth, imageHeight) {
  return [
    rect.x / imageWidth,
    rect.y / imageHeight,
    (rect.x + rect.w) / imageWidth,
    (rect.y + rect.h) / imageHeight,
  ];
}

/**
 * スプライトを貼る四角の頂点（画面のピクセル座標）
 *
 * `@X @Y` を中心に、コマの大きさ × `@SCALEX @SCALEY` で置く。
 * `@SCALEX` を負にすると左右が入れ替わり、向きを変えられる。
 * `@ROTZ` は度で、**Yが下向きなので正の角度は時計回り**に見える。
 *
 * @returns `[左上x, y, 右上x, y, 左下x, y, 右下x, y]`
 */
export function spriteQuad(object) {
  const hw = (num(object?.SIZE) * num(object?.SCALEX, 1)) / 2;
  const hh = (num(object?.SIZE) * num(object?.SCALEY, 1)) / 2;
  const angle = (num(object?.ROTZ) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = num(object?.X);
  const y = num(object?.Y);

  const out = [];
  for (const [cx, cy] of [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]]) {
    out.push(x + (cx * cos - cy * sin), y + (cx * sin + cy * cos));
  }
  return out;
}

/**
 * 画面の左上を (0, 0)、右下を (幅, 高さ) にする正射影行列
 *
 * 3Dと違い、**Yは下向き**。絵を描くソフトや画像ファイルの向きと同じにするため。
 */
export function screenProjection(width, height) {
  return orthographic(0, width, height, 0, -1, 1);
}

/** プレーンの枚数として読む。0以下・読めない値は1枚、多すぎれば上限で止める */
function planeCount(value) {
  const count = Math.floor(Math.abs(num(value)));
  return Math.min(Math.max(count, 1), MAX_PLANES_PER_SIDE);
}

/**
 * プレーンの番号一覧を作る（`setPlane(n1, n2)`）
 *
 * 3Dの下は -1 から下へ（-1, -2, …）、3Dの上は 0 から上へ（0, 1, …）。
 * 0 や書かなかった時は、下は -1 だけ、上は 0 だけになる。
 * 下の枚数は負の数で書いても枚数として読む。
 *
 * @param below 3Dの下の枚数
 * @param above 3Dの上の枚数
 * @returns 小さい順に並んだ番号の配列
 */
export function planeNumbers(below, above) {
  const out = [];
  for (let i = planeCount(below); i >= 1; i -= 1) out.push(-i);
  for (let i = 0; i < planeCount(above); i += 1) out.push(i);
  return out;
}

/**
 * オブジェクトの `@PLANE` を、実際に描くプレーン番号にする
 *
 * 無い番号や省略、整数でない値は **0 のプレーン**に置く。
 */
export function resolvePlane(plane, planes) {
  return Number.isInteger(plane) && planes.includes(plane) ? plane : 0;
}

/**
 * 2Dだけを取り出し、描く順に並べる
 *
 * **プレーン番号の小さい順が最優先**で、`@Z` はプレーンの中でだけ効く
 * （小さい順）。同じなら追加順のまま（後から足したものが上に重なる）。
 */
export function sortSprites(objects, planes = DEFAULT_PLANES) {
  return (objects ?? [])
    .filter(isSprite)
    .map((object, order) => ({ object, order, plane: resolvePlane(object.PLANE, planes), z: num(object.Z) }))
    .sort((a, b) => a.plane - b.plane || a.z - b.z || a.order - b.order)
    .map((entry) => entry.object);
}

/**
 * 3Dの下に描く分と、上に描く分に分ける
 *
 * 描く順は 下のプレーン → 3D → 上のプレーン。どちらも `sortSprites` の順。
 *
 * @returns `{ below, above }`
 */
export function splitByPlane(objects, planes = DEFAULT_PLANES) {
  const sorted = sortSprites(objects, planes);
  return {
    below: sorted.filter((o) => resolvePlane(o.PLANE, planes) < 0),
    above: sorted.filter((o) => resolvePlane(o.PLANE, planes) >= 0),
  };
}

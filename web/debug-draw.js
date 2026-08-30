// デバッグ表示（当たり判定の枠）（仕様書5.5節）
//
// `setDebug debug: true` を呼ぶと、各オブジェクトの当たり判定を**赤い線**で重ねて描く。
// 見た目と判定がずれていないか、目で確かめられるようにするため。
//
// ```coffee
// setDebug debug: true, opacity: 0.3
// ```
//
// 線の組み立てだけを受け持ち、実際に描くのは renderer.js。
// WebGL に依存しないため単体テストできる。

import { KIND_2D } from "./kind.js";

/** 枠の色（キーコンフィグの目印と同じ赤 #ff3b30） */
export const DEBUG_COLOR = [1, 0.231, 0.188];

/**
 * 枠の濃さの既定値
 *
 * 枠はあくまで**補助**なので、半透明にして見た目の邪魔をしないようにする。
 */
export const DEFAULT_OPACITY = 0.5;

/** 球の輪の分割数（滑らかさと線の本数の兼ね合い） */
const RING_SEGMENTS = 24;

/** デバッグ表示の設定 */
const option = {
  /** 当たり判定の枠を描くか */
  debug: false,
  /** 枠の濃さ */
  opacity: DEFAULT_OPACITY,
};

/**
 * デバッグ表示を切り替える（書いた項目だけ変わる）
 *
 * ```coffee
 * setDebug debug: true, opacity: 0.3
 * ```
 *
 * | キー | 内容 | 既定値 |
 * | --- | --- | --- |
 * | `debug` | 当たり判定の枠を描くか | `false` |
 * | `opacity` | 枠の濃さ（0より大きく1以下） | `0.5` |
 *
 * `setDebug true` のように真偽値だけを渡す短い書き方もできる。
 * 引数を省略すると入になる。**ゲームを実行し直すと既定へ戻る。**
 */
export function setDebug(param) {
  // 短い書き方（真偽値だけ、または省略）
  if (param === undefined) {
    option.debug = true;
    return debugOption();
  }
  if (typeof param === "boolean") {
    option.debug = param;
    return debugOption();
  }

  if (typeof param?.debug === "boolean") option.debug = param.debug;

  const opacity = param?.opacity;
  // 0 だと見えず、1 を超えると意味を成さない
  if (typeof opacity === "number" && Number.isFinite(opacity) && opacity > 0 && opacity <= 1) {
    option.opacity = opacity;
  } else if (opacity !== undefined) {
    option.opacity = DEFAULT_OPACITY;
  }
  return debugOption();
}

/** いまのデバッグ表示の設定 */
export function debugOption() {
  return { ...option };
}

/** 直方体の8つの角（符号の組み合わせ） */
const CORNERS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
/** 角どうしを結ぶ12本の辺 */
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** 直方体のワイヤーフレーム */
function boxLines(b, out) {
  const corners = CORNERS.map(([sx, sy, sz]) => [
    b.X + sx * b.hw,
    b.Y + sy * b.hh,
    b.Z + sz * b.hd,
  ]);
  for (const [a, c] of EDGES) out.push(...corners[a], ...corners[c]);
}

/** XY平面の矩形（奥行きを持たない） */
function rectLines(b, out) {
  const points = [
    [b.X - b.hw, b.Y - b.hh],
    [b.X + b.hw, b.Y - b.hh],
    [b.X + b.hw, b.Y + b.hh],
    [b.X - b.hw, b.Y + b.hh],
  ];
  for (let i = 0; i < 4; i += 1) {
    const a = points[i];
    const c = points[(i + 1) % 4];
    out.push(a[0], a[1], b.Z, c[0], c[1], b.Z);
  }
}

/**
 * 輪を1つ描く
 *
 * @param 軸 どの2軸で回すか（`[0,1]` なら XY平面）
 */
function ringLines(b, axes, out) {
  const center = [b.X, b.Y, b.Z];
  for (let i = 0; i < RING_SEGMENTS; i += 1) {
    const a1 = (i / RING_SEGMENTS) * Math.PI * 2;
    const a2 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
    for (const angle of [a1, a2]) {
      const points = [...center];
      points[axes[0]] += Math.cos(angle) * b.r;
      points[axes[1]] += Math.sin(angle) * b.r;
      out.push(...points);
    }
  }
}

/**
 * 円柱の枠（上下の輪と、縦の線）
 *
 * 縦の線は4本だけにする。輪だけだと立体に見えず、
 * 多くすると細かい枠が読みにくくなるため。
 */
function cylinderLines(b, out) {
  for (const y of [b.Y - b.hh, b.Y + b.hh]) {
    ringLines({ X: b.X, Y: y, Z: b.Z, r: b.r }, [0, 2], out);
  }
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const x = b.X + Math.cos(angle) * b.r;
    const z = b.Z + Math.sin(angle) * b.r;
    out.push(x, b.Y - b.hh, z, x, b.Y + b.hh, z);
  }
}

/**
 * 当たり判定の範囲から、線の頂点を組み立てる
 *
 * 種別で描き分ける。**2Dは平らな枠**（`@intersect` が見る範囲）、
 * それ以外は立体の枠（`@collision` が見る範囲）にする。
 *
 * @param bounds `boundsOf()` が返した範囲。null なら何も描かない
 * @param kind オブジェクトの種別（`resolveKind()` の結果）
 * @returns `gl.LINES` へ渡す頂点（x,y,z の並び）
 */
export function boundaryLines(bounds, kind) {
  if (!bounds) return new Float32Array(0);

  const out = [];
  const isFlat = kind === KIND_2D;
  if (bounds.shape === "cylinder") {
    // 真横から見ると矩形になるので、2Dでは幅を半径にそろえて描く
    if (isFlat) rectLines({ ...bounds, hw: bounds.r }, out);
    else cylinderLines(bounds, out);
  } else if (bounds.shape === "sphere") {
    // 2Dなら、正面から見た輪だけで足りる
    if (isFlat) ringLines(bounds, [0, 1], out);
    else {
      ringLines(bounds, [0, 1], out);
      ringLines(bounds, [1, 2], out);
      ringLines(bounds, [0, 2], out);
    }
  } else if (isFlat) {
    rectLines(bounds, out);
  } else {
    boxLines(bounds, out);
  }
  return new Float32Array(out);
}

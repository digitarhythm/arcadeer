// ライトの管理（仕様書6.2.6節）
//
// カメラ（camera.js）と同じく、名前を付けて辞書のように扱う。
// 影を落とすライトは1つだけ選べる（シャドウマップに使う）。
//
// WebGL に依存しないため単体テストできる。実際の描画は renderer.js が行う。

import { parseColor, parseColorOrNull } from "./color.js";

/** 何も置かなくても用意されるライトの名前 */
export const DEFAULT_LIGHT_NAME = "sun";

/**
 * 同時に扱えるライトの数
 *
 * WebGL1 の uniform 数に収めるための上限。環境光は別枠で数えない。
 */
export const MAX_LIGHTS = 4;

/** 使える種類 */
export const LIGHT_TYPES = ["directional", "point", "ambient"];

/**
 * 環境光の既定
 *
 * 「環境光 ＋ ライトの明るさ」が 1.0 を超えると白く飛んでしまうため、
 * 既定のライト（0.8）と合わせてちょうど 1.0 に収まる値にする。
 */
const DEFAULT_AMBIENT = "#333333";

/** ライト1つぶんの既定値 */
export function defaultLightParams() {
  return {
    /** "directional"（平行光）/ "point"（点光源）/ "ambient"（環境光として足す） */
    type: "directional",
    // 既定カメラ（右斜め上から見下ろす）に合わせ、上・手前寄りから差す
    X: 4,
    Y: 10,
    Z: 6,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    /** 光の色 */
    COLOR: "#ffffff",
    /** 明るさの倍率（環境光と足して 1.0 に収まる値を既定にする） */
    intensity: 0.8,
    /** 点光源が届く距離 */
    range: 20,
    /** このライトが影を作るか（1つだけ有効） */
    shadow: false,
    /**
     * 影を落とす範囲の半径（カメラの注視点を中心とした正方形の半幅）
     *
     * 広くすると遠くまで影が出るが、そのぶん粗くなる。
     */
    shadowRadius: 20,
  };
}

/** 名前 → ライト */
const store = new Map();
let ambientColor = parseColor(DEFAULT_AMBIENT);

/** 既定のライトを用意する */
function ensureDefault() {
  if (!store.has(DEFAULT_LIGHT_NAME)) {
    store.set(DEFAULT_LIGHT_NAME, {
      name: DEFAULT_LIGHT_NAME,
      ...defaultLightParams(),
      // 既定のライトが影を作る
      shadow: true,
    });
  }
}

/** 知らない種類は平行光として扱う */
function normalizeType(light) {
  if (!LIGHT_TYPES.includes(light.type)) light.type = "directional";
}

/**
 * ライトを追加する（同じ名前なら置き換える）
 *
 * ```coffee
 * addLight
 *   name: "torch"
 *   type: "point"
 *   X: 0
 *   Y: 2
 *   Z: 3
 *   COLOR: "#ff8800"
 * ```
 */
export function addLight(param) {
  ensureDefault();
  const name = param?.name;
  if (typeof name !== "string" || name === "") {
    throw new Error("addLight: name is required");
  }
  // 置き換えなら上限に関係なく通す
  if (!store.has(name) && store.size >= MAX_LIGHTS) {
    throw new Error(`addLight: too many lights (max ${MAX_LIGHTS})`);
  }
  const light = { ...defaultLightParams(), ...param, name };
  normalizeType(light);
  store.set(name, light);
  return light;
}

/**
 * 既にあるライトの設定を変える（指定した項目だけを書き換える）
 *
 * `name` を省略すると既定のライトが対象になる。
 */
export function setLight(param) {
  ensureDefault();
  const name = param?.name ?? DEFAULT_LIGHT_NAME;
  const light = store.get(name);
  if (!light) {
    throw new Error(`light not found: ${name}`);
  }
  for (const [key, value] of Object.entries(param ?? {})) {
    // 名前は付け替えさせない（別のライトにしたい場合は addLight を使う）
    if (key === "name") continue;
    if (key in light) light[key] = value;
  }
  normalizeType(light);
  return light;
}

/** 名前でライトを取り出す（無ければ null） */
export function getLight(name) {
  ensureDefault();
  return store.get(name) ?? null;
}

/** ライトを削除する */
export function removeLight(name) {
  ensureDefault();
  const removed = store.delete(name);
  // 既定のライトは消えたままにしない
  ensureDefault();
  return removed;
}

/** すべてのライトを捨てる（ゲーム実行のたびに呼ぶ） */
export function clearLights() {
  store.clear();
  ambientColor = parseColor(DEFAULT_AMBIENT);
  ensureDefault();
}

/** 追加順のライト一覧 */
export function lights() {
  ensureDefault();
  return [...store.values()];
}

/** 影を作るライト（無ければ null）。複数あれば最初の1つ */
export function shadowLight() {
  return lights().find((l) => l.shadow === true) ?? null;
}

/**
 * 環境光の色を設定する
 *
 * 読めない値は**無視する**（今の値を保つ）。白に落とすと陰まで最大の明るさになり、
 * 絵が破綻してしまうため。
 */
export function setAmbient(color) {
  const parsed = parseColorOrNull(color);
  if (parsed) ambientColor = parsed;
}

/** 環境光の色（0〜1のRGBA） */
export function ambient() {
  return ambientColor.slice();
}

/**
 * 平行光が**進む向き**（長さ1）
 *
 * 位置から注視点へ向かう向き。位置と注視点が同じ場合は真下へ向ける。
 */
export function lightDirection(light) {
  const dx = (light?.targetX ?? 0) - (light?.X ?? 0);
  const dy = (light?.targetY ?? 0) - (light?.Y ?? 0);
  const dz = (light?.targetZ ?? 0) - (light?.Z ?? 0);
  const length = Math.hypot(dx, dy, dz);
  // 長さが無いと向きが決まらないため、真下を既定にする
  if (length < 1e-6) return [0, -1, 0];
  return [dx / length, dy / length, dz / length];
}

/**
 * シェーダーへ渡す3成分
 *
 * 平行光は**進む向き**、点光源は**位置**を渡す。
 */
export function lightVector(light) {
  if (light?.type === "point") {
    return [light.X ?? 0, light.Y ?? 0, light.Z ?? 0];
  }
  return lightDirection(light);
}

if (typeof window !== "undefined") {
  window.arcadeerLights = lights;
  window.arcadeerShadowLight = shadowLight;
  window.arcadeerAmbient = ambient;
}

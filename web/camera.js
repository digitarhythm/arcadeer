// カメラ管理
//
// プロジェクトには必ず既定のカメラが1つあり、追加で何台でも置ける。
// 各カメラは「画面へ出す」か「テクスチャへ出す」かを選べる（3Dオブジェクトへの貼り付け用）。
// DOM/WebGLに依存しないため、単体テストできる。

import { lookAt, perspective } from "./matrix.js";

/** 既定のカメラの名前 */
export const DEFAULT_CAMERA_NAME = "main";

/** 出力先として扱える値 */
const OUTPUTS = ["screen", "texture"];

/**
 * 画角と焦点距離の換算に使うセンサーの縦幅（mm）
 *
 * 35mmフルサイズ（36×24mm）を基準にする。`fov` は縦方向の画角のため縦の24mmを使う。
 */
export const SENSOR_HEIGHT_MM = 24;

/** 焦点距離（mm）から縦画角（度）を求める */
export function lensToFov(mm) {
  return (Math.atan(SENSOR_HEIGHT_MM / (2 * mm)) * 2 * 180) / Math.PI;
}

/** 縦画角（度）から焦点距離（mm）を求める */
export function fovToLens(deg) {
  return SENSOR_HEIGHT_MM / (2 * Math.tan((deg * Math.PI) / 180 / 2));
}

/** 正の有限数か */
function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 画角と焦点距離を辻褄が合うようにそろえる
 *
 * 両方が指定された場合は**焦点距離を優先**する（意図がより具体的なため）。
 */
function syncLens(camera, param) {
  if (positive(param?.lens)) {
    camera.lens = param.lens;
    camera.fov = lensToFov(param.lens);
  } else if (positive(param?.fov)) {
    camera.fov = param.fov;
    camera.lens = fovToLens(param.fov);
  }
  // どちらの指定も無い（または不正な）場合は、今の値をそのまま保つ
}

/**
 * 既定のカメラ設定
 *
 * XY平面（Z=0）を**右斜め上から見下ろす**位置に置く。
 * 呼ぶたびに新しい値を返すため、書き換えても既定値は壊れない。
 */
export function defaultCameraParams() {
  return {
    // 右（+X）・上（+Y）・手前（+Z）から原点を見る
    X: 6,
    Y: 6,
    Z: 10,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    upX: 0,
    upY: 1,
    upZ: 0,
    /** 縦方向の画角（度） */
    fov: 45,
    /** 焦点距離（mm・35mmフルサイズ換算）。画角と連動する（45度 ≒ 29mm） */
    lens: fovToLens(45),
    near: 0.1,
    far: 1000,
    /** "screen" なら画面へ、"texture" ならテクスチャへ描く */
    output: "screen",
  };
}

/** 名前 → カメラ */
const cameras = new Map();
/** 画面へ出しているカメラの名前 */
let active = DEFAULT_CAMERA_NAME;

/** 既定のカメラを用意する */
function ensureDefault() {
  if (!cameras.has(DEFAULT_CAMERA_NAME)) {
    cameras.set(DEFAULT_CAMERA_NAME, {
      name: DEFAULT_CAMERA_NAME,
      ...defaultCameraParams(),
    });
  }
}

/**
 * カメラを追加する（同じ名前なら置き換える）
 *
 * ```coffee
 * addCamera
 *   name: "sub"
 *   X: 0
 *   Y: 10
 *   Z: 0
 * ```
 */
export function addCamera(param) {
  const name = param?.name;
  if (typeof name !== "string" || name === "") {
    throw new Error("addCamera: name is required");
  }
  const camera = { ...defaultCameraParams(), ...param, name };
  syncLens(camera, param);
  // 知らない出力先は画面扱いにする
  if (!OUTPUTS.includes(camera.output)) camera.output = "screen";
  cameras.set(name, camera);
  return camera;
}

/**
 * 既にあるカメラの設定を変える（指定した項目だけを書き換える）
 *
 * `name` を省略すると、画面へ出しているカメラが対象になる。
 * 追従などで注視点だけを毎フレーム変えたい場面に使う。
 *
 * ```coffee
 * setCamera
 *   targetX: @myship.X
 *   targetY: @myship.Y
 *   targetZ: @myship.Z
 * ```
 */
export function setCamera(param) {
  ensureDefault();
  const name = param?.name ?? active;
  const camera = cameras.get(name);
  if (!camera) {
    throw new Error(`camera not found: ${name}`);
  }

  for (const [key, value] of Object.entries(param ?? {})) {
    // 名前は付け替えさせない（別のカメラとして追加したい場合は addCamera を使う）
    if (key === "name") continue;
    // 画角と焦点距離は連動させるため、まとめて後から処理する
    if (key === "fov" || key === "lens") continue;
    if (key in camera) camera[key] = value;
  }
  if ("fov" in (param ?? {}) || "lens" in (param ?? {})) {
    syncLens(camera, param);
  }
  // 知らない出力先は画面扱いにする
  if (!OUTPUTS.includes(camera.output)) camera.output = "screen";
  return camera;
}

/** 名前からカメラを取り出す（無ければ null） */
export function getCamera(name) {
  ensureDefault();
  return cameras.get(name) ?? null;
}

/** 登録されているカメラ名の一覧 */
export function cameraNames() {
  ensureDefault();
  return [...cameras.keys()];
}

/** カメラを消す（既定のカメラは消せない） */
export function removeCamera(name) {
  if (name === DEFAULT_CAMERA_NAME) return;
  cameras.delete(name);
  // 消したカメラを使っていたら既定へ戻す
  if (active === name) active = DEFAULT_CAMERA_NAME;
}

/** 既定のカメラだけの状態へ戻す（ゲーム実行のたびに呼ぶ） */
export function clearCameras() {
  cameras.clear();
  active = DEFAULT_CAMERA_NAME;
  ensureDefault();
}

/** 画面へ出すカメラを切り替える */
export function setActiveCamera(name) {
  ensureDefault();
  if (!cameras.has(name)) {
    throw new Error(`camera not found: ${name}`);
  }
  active = name;
}

/** 画面へ出しているカメラ */
export function activeCamera() {
  ensureDefault();
  return cameras.get(active) ?? cameras.get(DEFAULT_CAMERA_NAME);
}

/** カメラから注視行列を作る */
export function viewMatrix(camera) {
  return lookAt(
    [camera.X, camera.Y, camera.Z],
    [camera.targetX, camera.targetY, camera.targetZ],
    [camera.upX, camera.upY, camera.upZ],
  );
}

/** カメラから投影行列を作る（画角は度で持ち、ここでラジアンに直す） */
export function projectionMatrix(camera, aspect) {
  return perspective((camera.fov * Math.PI) / 180, aspect, camera.near, camera.far);
}

if (typeof window !== "undefined") {
  window.arcadeerActiveCamera = activeCamera;
}

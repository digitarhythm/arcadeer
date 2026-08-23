// ゲームコントローラー（仕様書6.2.9節）
//
// **Gamepad API**（`navigator.getGamepads()`）で読んだ XInput 準拠のパッドと、
// キーボードの状態を混ぜて `GAMEPAD` へ入れる。
//
// 状態の組み立ては `applyGamepads` に分けてあり、DOM に依存しないため単体テストできる。

import { isKeyDown } from "./runtime.js";

/** cursor の並び（時計回り） */
export const CURSOR_UP = 0;
export const CURSOR_RIGHT = 1;
export const CURSOR_DOWN = 2;
export const CURSOR_LEFT = 3;

/** cursor に混ぜるキーボードのキー */
export const CURSOR_KEYS = [
  ["ArrowUp", "KeyW"],
  ["ArrowRight", "KeyD"],
  ["ArrowDown", "KeyS"],
  ["ArrowLeft", "KeyA"],
];

/**
 * cursor に混ぜるパッドの4方向キー
 *
 * XInput 準拠（standard mapping）での並び。
 */
const CURSOR_PAD_INDEX = [12, 15, 13, 14];

/** button の数 */
export const BUTTON_COUNT = 12;

/**
 * button に混ぜるキーボードのキー（`yuiohjklnm,.` の並び）
 *
 * 3段×4列に並ぶ配置で、パッドのボタンと対応させやすいようにしてある。
 */
export const BUTTON_KEYS = [
  "KeyY", "KeyU", "KeyI", "KeyO",
  "KeyH", "KeyJ", "KeyK", "KeyL",
  "KeyN", "KeyM", "Comma", "Period",
];

/**
 * button に混ぜるパッドのボタン
 *
 * XInput 準拠（standard mapping）の先頭12個。
 * 6 と 7（LT / RT）はアナログで、`value` に 0.0〜1.0 が入る。
 */
const BUTTON_PAD_INDEX = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** スティックの数と、1本あたりの軸数 */
const STICK_COUNT = 2;
const AXIS_COUNT = 2;

/**
 * ハットスイッチが「どこも押していない」時の値
 *
 * 4方向キーを1本の軸で表す形式で、8方向を -1〜1 に並べ、中立だけが範囲の外に出る。
 * DirectInput のパッドでよく使われる。
 */
export const HAT_NEUTRAL = 1.2857;

/** 標準（XInput 準拠）の配置 */
const STANDARD_LAYOUT = {
  name: "standard",
  source: "standard",
  hatAxis: null,
  left: [0, 1],
  right: [2, 3],
  dpadButtons: CURSOR_PAD_INDEX,
};

/**
 * 機種ごとの配置のプリセット
 *
 * `製造元:製品` で引く。**実機で確かめたものだけ**を載せる。
 * ここに無い機種は、その場で見当をつける（`guessLayout`）。
 */
export const PRESETS = {
  // エレコム JC-U3613M（DirectInput モード）
  // macOS では XInput モードだと機器として現れないため、こちらを使うことになる
  "056e:2003": {
    name: "ELECOM JC-U3613M (DirectInput)",
    hatAxis: 9,
    left: [0, 1],
    right: [2, 5],
    dpadButtons: null,
  },
};

/**
 * ハットスイッチの値を 上・右・下・左 に読み替える
 *
 * 8方向が -1〜1 に等間隔で並んでいるものとして扱う。
 */
export function decodeHat(value) {
  const none = [false, false, false, false];
  if (typeof value !== "number" || !Number.isFinite(value)) return none;
  // 中立は範囲の外に出る
  if (value > 1.05 || value < -1.05) return none;

  // -1 が上で、時計回りに8方向
  const dir = Math.round(((value + 1) * 7) / 2) % 8;
  return [
    dir === 7 || dir === 0 || dir === 1, // 上
    dir >= 1 && dir <= 3, // 右
    dir >= 3 && dir <= 5, // 下
    dir >= 5 && dir <= 7, // 左
  ];
}

/**
 * `id` から製造元と製品の番号を取り出す
 *
 * ブラウザによって書き方が違うため、両方に対応する。
 * - Chrome: `名前 (Vendor: 056e Product: 2003)`
 * - Firefox: `056e-2003-名前`
 */
export function parseGamepadId(id) {
  const text = typeof id === "string" ? id : "";
  const chrome = /vendor:\s*([0-9a-f]{4}).*?product:\s*([0-9a-f]{4})/i.exec(text);
  if (chrome) return { vendor: chrome[1].toLowerCase(), product: chrome[2].toLowerCase(), id: text };

  const firefox = /^([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(text);
  if (firefox) return { vendor: firefox[1].toLowerCase(), product: firefox[2].toLowerCase(), id: text };

  return { vendor: null, product: null, id: text };
}

/**
 * 知らない機種の配置を、その場で見当をつける
 *
 * DirectInput のパッドで多い並びを前提にする。
 * ハットスイッチは、中立の値（範囲の外）が出ている軸で見分ける。
 */
function guessLayout(raw) {
  const axes = raw?.axes ?? [];
  let hatAxis = null;
  axes.forEach((v, i) => {
    if (hatAxis === null && typeof v === "number" && Math.abs(v) > 1.05) hatAxis = i;
  });

  return {
    name: "generic",
    source: "guess",
    hatAxis,
    left: [0, 1],
    // Z と Rz を右スティックに使う並びが多い。軸が足りなければ詰める
    right: axes.length > 5 ? [2, 5] : [2, 3],
    // ハットが無い場合に備えて、方向がボタンで来る形も見る
    dpadButtons: hatAxis === null ? CURSOR_PAD_INDEX : null,
  };
}

/**
 * そのパッドの配置を決める
 *
 * 1. `mapping` が `"standard"` なら標準の配置
 * 2. プリセットにあればそれ
 * 3. どちらでもなければ、その場で見当をつける
 */
export function resolveLayout(raw) {
  if (raw?.mapping === "standard") return STANDARD_LAYOUT;

  const { vendor, product } = parseGamepadId(raw?.id);
  const preset = vendor && product ? PRESETS[`${vendor}:${product}`] : null;
  if (preset) return { source: "preset", ...preset };

  return guessLayout(raw);
}

/** 左スティックを4方向として扱う際、どこまで倒したら「押した」とみなすか */
export const DEFAULT_DEADZONE = 0.5;

/** コントローラーの設定 */
const option = {
  /** 左スティックの上下左右を、4方向キーへ混ぜるか */
  stickAsCursor: false,
  /** 4方向として扱う際のしきい値 */
  deadzone: DEFAULT_DEADZONE,
};

/**
 * コントローラーの設定を変える（書いた項目だけ）
 *
 * ```coffee
 * setGamepadOption
 *   stickAsCursor: true       # 左スティックでも4方向キーと同じ操作ができる
 *   deadzone: 0.5
 * ```
 */
export function setGamepadOption(param) {
  if (typeof param?.stickAsCursor === "boolean") {
    option.stickAsCursor = param.stickAsCursor;
  }
  const deadzone = param?.deadzone;
  // 0 だと少しの傾きで反応してしまい、1 を超えると決して反応しなくなる
  if (typeof deadzone === "number" && Number.isFinite(deadzone) && deadzone > 0 && deadzone <= 1) {
    option.deadzone = deadzone;
  } else if (deadzone !== undefined) {
    option.deadzone = DEFAULT_DEADZONE;
  }
  return { ...option };
}

/** いまの設定 */
export function gamepadOption() {
  return { ...option };
}

/**
 * 左スティックの傾きを、4方向の押下へ読み替える
 *
 * 各方向を -1 / 0 / 1 に切り分けてから混ぜる。
 * Y軸は上が負のため、上下は符号が逆になる。
 */
function stickToCursor([x, y]) {
  const z = option.deadzone;
  return [y < -z, x > z, y > z, x < -z];
}

/**
 * 接続されているコントローラーの状態
 *
 * ```coffee
 * behavior: (e) ->
 *   super(e)
 *   pad = GAMEPAD[0]
 *   @X += 4 if pad.cursor[1].pressed        # 右
 *   @XS = pad.axes[0][0] * 4                # 左スティックの左右
 *   @jump() if pad.button[0].pressed
 * ```
 *
 * パッドが1つも繋がっていなくても、**キーボード用に `GAMEPAD[0]` は必ずある**。
 */
export const GAMEPAD = [];

/** -1〜1 に収める（数値でなければ 0） */
function clampAxis(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

/** 1つぶんの入れ物を作る */
function createPad() {
  return {
    cursor: Array.from({ length: CURSOR_KEYS.length }, () => ({ pressed: false, value: 0 })),
    button: Array.from({ length: BUTTON_COUNT }, () => ({ pressed: false, value: 0 })),
    axes: Array.from({ length: STICK_COUNT }, () => new Array(AXIS_COUNT).fill(0)),
  };
}

/** 生データの1ボタンを 0〜1 の値にする */
function padValue(raw, index) {
  const button = raw?.buttons?.[index];
  if (!button) return 0;
  if (typeof button === "number") return clampAxis(button);
  if (typeof button.value === "number") return Math.min(1, Math.max(0, button.value));
  return button.pressed ? 1 : 0;
}

/** 入れ物へ、パッドとキーボードの状態を混ぜて入れる */
function fillPad(pad, raw, keys, withKeyboard) {
  const layout = resolveLayout(raw);

  const mix = (slot, padValueForSlot, keyCodes) => {
    let value = padValueForSlot;
    if (withKeyboard) {
      for (const code of keyCodes) {
        // どちらかが押されていれば押されている扱い。値は大きいほうを採る
        if (keys(code)) value = Math.max(value, 1);
      }
    }
    slot.value = value;
    slot.pressed = value > 0;
  };

  // 方向へ混ぜる前にスティックの値を確定させる
  const sticks = [layout.left, layout.right];
  for (let stick = 0; stick < STICK_COUNT; stick += 1) {
    for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
      pad.axes[stick][axis] = clampAxis(raw?.axes?.[sticks[stick][axis]] ?? 0);
    }
  }

  // 4方向キー。ハットスイッチの機種は軸から読み替える
  const hat =
    layout.hatAxis === null ? null : decodeHat(raw?.axes?.[layout.hatAxis]);
  // 設定が入なら、左スティックの傾きも同じ方向として扱う
  const stick = option.stickAsCursor ? stickToCursor(pad.axes[0]) : null;

  pad.cursor.forEach((slot, i) => {
    let fromPad = hat
      ? (hat[i] ? 1 : 0)
      : padValue(raw, layout.dpadButtons?.[i] ?? CURSOR_PAD_INDEX[i]);
    if (stick?.[i]) fromPad = 1;
    mix(slot, fromPad, CURSOR_KEYS[i]);
  });

  pad.button.forEach((slot, i) => mix(slot, padValue(raw, BUTTON_PAD_INDEX[i]), [BUTTON_KEYS[i]]));
}

/**
 * 生データとキーの状態から `GAMEPAD` を作り直す
 *
 * 入れ物は**作り直さず中身だけ書き換える**。作り直すと、既に受け取っている
 * ゲームコードが古いものを見続けてしまうため。
 *
 * @param rawPads `navigator.getGamepads()` の結果（繋がっていない枠は null）
 * @param pressed 押されているキーの集合、または `(code) => boolean`
 */
export function applyGamepads(rawPads, pressed) {
  const keys =
    typeof pressed === "function" ? pressed : (code) => pressed?.has?.(code) === true;

  // `navigator.getGamepads()` は未接続の枠も返すため、末尾の空きは数えない。
  // 添字はAPIの並びに合わせたいので、間の空きはそのまま残す
  const list = (rawPads ?? []).slice();
  let last = -1;
  list.forEach((raw, i) => {
    if (raw) last = i;
  });
  // キーボードで遊べるよう、パッドが無くても1つは用意する
  const count = Math.max(last + 1, 1);

  while (GAMEPAD.length > count) GAMEPAD.pop();
  while (GAMEPAD.length < count) GAMEPAD.push(createPad());

  for (let i = 0; i < count; i += 1) {
    // キーボードは GAMEPAD[0] にだけ混ぜる
    fillPad(GAMEPAD[i], list[i] ?? null, keys, i === 0);
  }
  return GAMEPAD;
}

/** すべて離した状態へ戻す（ゲームを実行するたびに呼ぶ） */
export function clearGamepads() {
  GAMEPAD.length = 0;
  GAMEPAD.push(createPad());
  // 前回の実行で入れた設定を持ち越さない
  option.stickAsCursor = false;
  option.deadzone = DEFAULT_DEADZONE;
}

/**
 * Gamepad API から読み取って `GAMEPAD` を更新する（毎フレーム呼ぶ）
 *
 * `navigator.getGamepads()` は**呼んだ時点の写し**を返すため、
 * 覚えておかず毎回読み直す必要がある。
 */
export function updateGamepads() {
  const raw =
    typeof navigator !== "undefined" && typeof navigator.getGamepads === "function"
      ? [...navigator.getGamepads()]
      : [];
  return applyGamepads(raw, isKeyDown);
}

if (typeof window !== "undefined") {
  window.arcadeerUpdateGamepads = updateGamepads;
  window.arcadeerGamepad = GAMEPAD;
}

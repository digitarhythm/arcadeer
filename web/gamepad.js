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
/** スティックとして使える軸か（静止時に端へ張り付いていないか） */
function looksLikeStick(value) {
  // 静止時に ±1 へ張り付く軸は、トリガーか未使用。倒す向きの片方を表現できない
  return typeof value === "number" && Math.abs(value) < 0.9;
}

function guessLayout(raw) {
  const axes = raw?.axes ?? [];
  let hatAxis = null;
  axes.forEach((v, i) => {
    if (hatAxis === null && typeof v === "number" && Math.abs(v) > 1.05) hatAxis = i;
  });

  // ハット以外で、静止時に0付近にある軸（スティックとして使えるもの）
  const usable = axes
    .map((v, i) => (i !== hatAxis && looksLikeStick(v) ? i : null))
    .filter((i) => i !== null);

  // まずは DirectInput で多い並びを当て、使えない軸だけ差し替える。
  // こうすることで、普通の機種はこれまでどおりの割り当てを保てる
  const 慣例 = axes.length > 5 ? [0, 1, 2, 5] : [0, 1, 2, 3];
  const 使用済み = new Set();
  const pick = (n) => {
    const 候補 = 慣例[n];
    if (候補 !== undefined && usable.includes(候補) && !使用済み.has(候補)) {
      使用済み.add(候補);
      return 候補;
    }
    // 使えない軸なら、まだ使っていない軸から順に充てる
    const 代わり = usable.find((i) => !使用済み.has(i));
    if (代わり !== undefined) {
      使用済み.add(代わり);
      return 代わり;
    }
    return 候補 ?? 0;
  };

  return {
    name: "generic",
    source: "guess",
    hatAxis,
    left: [pick(0), pick(1)],
    right: [pick(2), pick(3)],
    // ハットが無い場合に備えて、方向がボタンで来る形も見る
    dpadButtons: hatAxis === null ? CURSOR_PAD_INDEX : null,
  };
}

/**
 * 遊ぶ人の設定を引く関数
 *
 * キーコンフィグ（6.2.10節）を使う場合に差し込む。
 * ここに依存を持ち込まないよう、外から渡してもらう形にしてある。
 */
let configLookup = null;

/** 設定を引く関数を差し込む（null で解除） */
export function setConfigLookup(fn) {
  configLookup = typeof fn === "function" ? fn : null;
}

/**
 * そのパッドの配置を決める
 *
 * 1. **遊ぶ人の設定**があればそれ（最優先）
 * 2. `mapping` が `"standard"` なら標準の配置
 * 3. プリセットにあればそれ
 * 4. どれでもなければ、その場で見当をつける
 */
export function resolveLayout(raw) {
  const { vendor, product } = parseGamepadId(raw?.id);
  const key = vendor && product ? `${vendor}:${product}` : null;

  // 遊ぶ人が自分で決めた割り当てを、何より優先する
  const configured = configLookup?.(key, raw) ?? null;
  if (configured) return configured;

  if (raw?.mapping === "standard") return STANDARD_LAYOUT;

  const preset = key ? PRESETS[key] : null;
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
  /**
   * そのゲームが使う操作の申告（書かなければ null＝すべて）
   *
   * キーコンフィグは、ここに書かれた操作**だけ**を尋ねる。
   * ボタンの少ないパッドでも、必要な項目だけを設定すれば遊べる。
   */
  use: null,
};

/**
 * 使う操作の申告を、扱える形に整える
 *
 * 書き方を間違えていた場合は、申告そのものを無かったことにする
 * （中途半端に一部だけ効くと、原因が分かりにくいため）。
 */
function 申告を正す(use) {
  if (!use || typeof use !== "object" || Array.isArray(use)) return null;
  const out = {};
  if (typeof use.cursor === "boolean") out.cursor = use.cursor;
  if (Array.isArray(use.button)) {
    out.button = use.button.filter((v) => Number.isInteger(v) && v >= 0 && v < BUTTON_COUNT);
  }
  if (Array.isArray(use.stick)) {
    out.stick = use.stick.filter((v) => v === "left" || v === "right");
  }
  return out;
}

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
  if (param?.use !== undefined) option.use = 申告を正す(param.use);
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
  return { ...option, use: option.use ? { ...option.use } : null };
}

/**
 * 枠ごとに覚えておく、その機種の見立て
 *
 * **毎フレーム判定し直してはいけない。**ハットスイッチは「中立の値が範囲外」で
 * 見つけるため、**押している間は見失う**。静止している最初の1回で決めて覚える。
 */
const layouts = new Map();

/**
 * 軸が「端に張り付いている」とみなす大きさ
 *
 * スティックが静止位置でぴたりと端を指すことはないため、
 * この値を超えていれば**まだ触られていない**とみなす。
 */
const PINNED_EDGE = 0.99;

/**
 * 枠ごとの、軸の**静止位置**と**張り付きの見立て**
 *
 * 多くの機種は手を離すと 0 に戻るが、**一度も触られていない間 -1 を返し続ける
 * 軸を持つ機種がある**（実機で確認: 11ff:9608 の左スティック上下）。
 * これをそのまま返すと、何もしていないのに「上に倒しっぱなし」になり、
 * 実際に上へ倒しても値が変わらない。
 *
 * そこで、**初めて見た時に端へ張り付いている軸は、値が届いていない**とみなして
 * 0 を返し、一度でも中間の値が来たら、そこから普通の軸として扱う。
 */
const centers = new Map();

/**
 * その枠の軸の見立てを返す
 *
 * 軸の数が変わった場合は、別の機種に差し替わったとみなして取り直す。
 */
function centerOf(index, axes) {
  const kept = centers.get(index);
  if (kept && kept.rest.length === axes.length) {
    // 中間の値が来たら、その軸は「値が届いていない」わけではないと分かる
    axes.forEach((v, i) => {
      if (kept.pinned[i] && Math.abs(clampAxis(v)) < PINNED_EDGE) kept.pinned[i] = false;
    });
    return kept;
  }
  const pinned = axes.map((v) => Math.abs(clampAxis(v)) >= PINNED_EDGE);
  // 張り付いている軸は静止位置が分からないため、0 とみなしておく
  const rest = axes.map((v, i) => (pinned[i] ? 0 : clampAxis(v)));
  const fresh = { rest, pinned };
  centers.set(index, fresh);
  return fresh;
}

/**
 * その枠の配置を返す（初めて見た時に決めて覚える）
 *
 * 軸の数が変わった場合は、別の機種に差し替わったとみなして決め直す。
 */
function layoutOf(index, raw) {
  const axes = raw?.axes ?? [];
  const kept = layouts.get(index);
  if (kept && kept.axisCount === axes.length) return kept.layout;
  const layout = resolveLayout(raw);
  layouts.set(index, { axisCount: axes.length, layout });
  return layout;
}

/**
 * 左スティックの傾きを、4方向の押下へ読み替える
 *
 * **静止位置からのぶれ**で判断し、各方向を -1 / 0 / 1 に切り分けてから混ぜる。
 * Y軸は上が負のため、上下は符号が逆になる。
 */
function stickToCursor([x, y], [cx, cy]) {
  const z = option.deadzone;
  const dx = x - cx;
  const dy = y - cy;
  return [dy < -z, dx > z, dy > z, dx < -z];
}

/**
 * ゲームへ操作を送るのを止めているか
 *
 * キーコンフィグの最中は、押したボタンが**設定のための入力**であって、
 * ゲームへの操作ではない。止めておかないと、設定しながら
 * ゲームの中の自機が動いてしまう。
 */
let suspended = false;

/**
 * ゲームへ操作を送るのを止める／再開する
 *
 * 再開する時は、**覚えていた見立てを捨てる**。設定中に割り当てが
 * 変わっている場合、古い見立てのままだと新しい設定が効かない。
 */
export function setGamepadSuspended(on) {
  const 次 = on === true;
  if (suspended && !次) {
    centers.clear();
    layouts.clear();
  }
  suspended = 次;
}

/** いま止めているか */
export function gamepadSuspended() {
  return suspended;
}

/** すべての枠を「何も押していない」状態に書き換える */
function releaseAll() {
  for (const pad of GAMEPAD) {
    for (const slot of pad.cursor) { slot.pressed = false; slot.value = 0; }
    for (const slot of pad.button) { slot.pressed = false; slot.value = 0; }
    for (const stick of pad.axes) stick.fill(0);
  }
  return GAMEPAD;
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
function fillPad(pad, raw, keys, withKeyboard, center, layout) {

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
      const 番号 = sticks[stick][axis];
      // 遊ぶ人が「使わない」と決めた軸は、常に倒していない扱い
      if (layout.stickNone?.[stick]?.[axis]) {
        pad.axes[stick][axis] = 0;
        continue;
      }
      // まだ値が届いていない軸は、倒していないものとして扱う
      if (center.pinned[番号]) {
        pad.axes[stick][axis] = 0;
        continue;
      }
      // 設定で「右へ倒すと負になる」と分かっている軸は、符号をそろえて返す
      const 符号 = layout.stickSigns?.[stick]?.[axis] ?? 1;
      pad.axes[stick][axis] = clampAxis((raw?.axes?.[番号] ?? 0) * 符号);
    }
  }

  // 4方向キー。ハットスイッチの機種は軸から読み替える
  const hat =
    layout.hatAxis === null ? null : decodeHat(raw?.axes?.[layout.hatAxis]);
  // 設定が入なら、左スティックの傾きも同じ方向として扱う
  const stick = option.stickAsCursor
    ? stickToCursor(pad.axes[0], [center.rest[layout.left[0]] ?? 0, center.rest[layout.left[1]] ?? 0])
    : null;

  pad.cursor.forEach((slot, i) => {
    // 「使わない」と決めた方向は、パッドからは受け取らない（キーボードは効く）
    if (layout.cursorNone?.[i]) {
      mix(slot, 0, CURSOR_KEYS[i]);
      return;
    }
    let fromPad = hat
      ? (hat[i] ? 1 : 0)
      : padValue(raw, layout.dpadButtons?.[i] ?? CURSOR_PAD_INDEX[i]);
    if (stick?.[i]) fromPad = 1;
    mix(slot, fromPad, CURSOR_KEYS[i]);
  });

  pad.button.forEach((slot, i) => {
    if (layout.buttonNone?.[i]) {
      mix(slot, 0, [BUTTON_KEYS[i]]);
      return;
    }
    // 設定があれば、その割り当て先を読む
    const 割り当て = layout.buttons?.[i] ?? BUTTON_PAD_INDEX[i];
    let value = padValue(raw, 割り当て);
    // トリガーが軸で届く機種向け（設定で軸を割り当てた場合）
    const 軸 = layout.buttonAxes?.[i];
    if (軸) {
      const ぶれ = (raw?.axes?.[軸.index] ?? 0) - (center.rest[軸.index] ?? 0);
      value = Math.max(value, Math.min(1, Math.max(0, ぶれ * 軸.sign)));
    }
    mix(slot, value, [BUTTON_KEYS[i]]);
  });
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

  // 設定中は、押されたものをゲームへ渡さない
  if (suspended) return releaseAll();

  for (let i = 0; i < count; i += 1) {
    const raw = list[i] ?? null;
    // キーボードは GAMEPAD[0] にだけ混ぜる
    fillPad(
      GAMEPAD[i], raw, keys, i === 0,
      centerOf(i, raw?.axes ?? []),
      layoutOf(i, raw),
    );
  }
  return GAMEPAD;
}

/** すべて離した状態へ戻す（ゲームを実行するたびに呼ぶ） */
export function clearGamepads() {
  GAMEPAD.length = 0;
  GAMEPAD.push(createPad());
  // 静止位置と配置の見立ては、実行のたびに取り直す
  centers.clear();
  layouts.clear();
  // 前回の実行で入れた設定を持ち越さない
  option.stickAsCursor = false;
  option.deadzone = DEFAULT_DEADZONE;
  option.use = null;
  suspended = false;
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

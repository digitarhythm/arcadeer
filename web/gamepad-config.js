// ゲームパッドのキーコンフィグ（仕様書6.2.10節）
//
// **遊ぶ人が、自分のパッドの割り当てを決める**ための仕組み。
//
// ゲームを作る人は XInput の名前（A・B・LB…）だけを見て書けばよく、
// 物理的な配置は気にしなくてよい。実際にどのボタンを当てるかは、
// 遊ぶ人が画面の指示に従って押していくことで決まる。
//
// 設定は**ゲームのURLごと**にブラウザへ保存する。
// 同じ人が別のゲームで別の割り当てにしたい場合にも応えられる。
//
// 画面に依存しないため単体テストできる。画面は gamepad-config-ui.js が受け持つ。

import { HAT_NEUTRAL } from "./gamepad.js";

/** 押されたと認める、静止位置からのぶれ */
const DETECT_THRESHOLD = 0.5;

/**
 * ハットスイッチ用の、低い基準
 *
 * 中立が範囲外にある形式では、**押しても変化がごく小さい**ことがある。
 * 例: 中立 -1.286 で、上を押すと -1（差は 0.29 しかない）。
 * 通常の基準では拾えないため、この軸だけ低くする。
 */
const HAT_DETECT_THRESHOLD = 0.1;

/** ハットスイッチとみなす、静止位置の大きさ */
const HAT_NEUTRAL_MIN = 1.05;

/** 保存する場所の頭 */
const STORAGE_PREFIX = "arcadeer.gamepad";

/** ボタンの並び（XInput 準拠。GAMEPAD[].button[0〜11] に対応） */
const BUTTON_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "BACK", "START", "LS", "RS"];

/** ボタンごとの、絵の中の目印 */
const BUTTON_MARKERS = {
  A: "pad-a", B: "pad-b", X: "pad-x", Y: "pad-y",
  LB: "pad-lb", RB: "pad-rb", LT: "pad-lt", RT: "pad-rt",
  BACK: "pad-back", START: "pad-start", LS: "pad-ls", RS: "pad-rs",
};

/** 4方向の目印と翻訳キー */
const CURSOR_STEPS = ["up", "right", "down", "left"].map((dir, index) => ({
  kind: "cursor",
  index,
  name: dir,
  marker: `pad-dpad-${dir}`,
  labelKey: `padconf.cursor.${dir}`,
}));

/** スティックの手順（右へ／下へ の2方向で、軸と向きが決まる） */
const STICK_STEPS = [
  { stick: 0, axis: 0, dir: "right", name: "LS-right", marker: "pad-ls", labelKey: "padconf.stick.leftRight" },
  { stick: 0, axis: 1, dir: "down", name: "LS-down", marker: "pad-ls", labelKey: "padconf.stick.leftDown" },
  { stick: 1, axis: 0, dir: "right", name: "RS-right", marker: "pad-rs", labelKey: "padconf.stick.rightRight" },
  { stick: 1, axis: 1, dir: "down", name: "RS-down", marker: "pad-rs", labelKey: "padconf.stick.rightDown" },
].map((s) => ({ kind: "stick", ...s }));

/**
 * 尋ねる順番
 *
 * 4方向 → ボタン12個 → スティック4方向 の全20項目。
 */
export const CONFIG_STEPS = [
  ...CURSOR_STEPS,
  ...BUTTON_NAMES.map((name, index) => ({
    kind: "button",
    index,
    name,
    marker: BUTTON_MARKERS[name],
    labelKey: `padconf.button.${name}`,
  })),
  ...STICK_STEPS,
];

/**
 * 「この項目は使わない」を表す割り当て
 *
 * ボタンの少ないパッドや、壊れた軸を持つパッドのために、
 * **割り当てずに飛ばせる**ようにしてある。飛ばした項目は常に 0 を返す。
 *
 * 「まだ尋ねていない」（null）とは区別する。尋ねていない項目は
 * これまでどおり自動判定に任せるが、飛ばした項目は自動判定も使わない。
 */
export const UNASSIGNED = Object.freeze({ kind: "none" });

/** ボタンが押されているか */
function pressedAt(raw, index) {
  const b = raw?.buttons?.[index];
  if (!b) return false;
  return typeof b === "object" ? b.pressed === true : b > 0.5;
}

/**
 * 押されたもの／倒されたものを見分ける
 *
 * **ボタンを優先する。**スティックに触れたまま押した場合でも、押した意図を採るため。
 * 軸は、静止していた時からのぶれが最も大きいものを採る。
 *
 * @returns `{ kind:"button", index }` / `{ kind:"axis", index, sign }` / 見分けられなければ null
 */
export function detectInput(before, after) {
  const count = after?.buttons?.length ?? 0;
  for (let i = 0; i < count; i += 1) {
    if (pressedAt(after, i) && !pressedAt(before, i)) return { kind: "button", index: i };
  }

  let found = null;
  let ratio = 1;
  (after?.axes ?? []).forEach((v, i) => {
    const base = before?.axes?.[i] ?? 0;
    const diff = v - base;
    // 中立が範囲外の軸（ハットスイッチ）は、低い基準で見る
    const rest =
      Math.abs(base) > HAT_NEUTRAL_MIN ? HAT_DETECT_THRESHOLD : DETECT_THRESHOLD;
    // 基準に対する超え具合で比べる。基準が違う軸どうしを公平に扱うため
    const over = Math.abs(diff) / rest;
    if (over > ratio) {
      ratio = over;
      found = { kind: "axis", index: i, sign: diff > 0 ? 1 : -1 };
    }
  });
  return found;
}

/**
 * その割り当てが「ハットスイッチ」かどうか
 *
 * 4方向が1本の軸に載っている形式は、**静止位置が -1〜1 の外**に出る。
 * これを見分けられれば、1方向を押してもらうだけで4方向すべてが決まる。
 */
export function isHatBinding(binding, restAxes) {
  if (binding?.kind !== "axis") return false;
  const rest = restAxes?.[binding.index];
  return typeof rest === "number" && Math.abs(rest) > HAT_NEUTRAL_MIN;
}

/** 空の設定を作る */
export function createConfig(name, key) {
  return {
    name: name ?? "",
    key: key ?? "",
    /** 4方向それぞれの割り当て */
    cursor: [null, null, null, null],
    /** ハットスイッチの軸（あれば） */
    hatAxis: null,
    /** ボタン12個の割り当て */
    buttons: new Array(BUTTON_NAMES.length).fill(null),
    /** スティック2本 × XY の軸と向き */
    sticks: [[null, null], [null, null]],
  };
}

/**
 * 手順の結果を書き込む
 *
 * 4方向でハットスイッチを選んだ場合は、**残り3方向も自動で埋める**。
 *
 * @returns 自動で埋まった項目の数
 */
export function recordStep(config, step, input) {
  if (!config || !step || !input) return 0;

  if (step.kind === "cursor") {
    if (input.kind === "hat") {
      config.hatAxis = input.index;
      for (let i = 0; i < config.cursor.length; i += 1) {
        config.cursor[i] = { kind: "hat", index: input.index };
      }
      // 押してもらった1方向を除いた数
      return config.cursor.length - 1;
    }
    config.cursor[step.index] = input;
    return 0;
  }

  if (step.kind === "button") {
    config.buttons[step.index] = input;
    return 0;
  }

  // スティックは軸と向きを覚える
  if (input.kind === "axis") {
    config.sticks[step.stick][step.axis] = { index: input.index, sign: input.sign };
  } else if (input.kind === "none") {
    config.sticks[step.stick][step.axis] = UNASSIGNED;
  }
  return 0;
}

/** 設定から、描画側が使う配置を作る */
export function buildLayoutFromConfig(config) {
  const dpadButtons = config.cursor.map((b) => (b?.kind === "button" ? b.index : null));
  const unassigned = (b) => b?.kind === "none";
  return {
    name: config.name || "config",
    source: "config",
    hatAxis: config.hatAxis ?? null,
    left: [config.sticks[0][0]?.index ?? 0, config.sticks[0][1]?.index ?? 1],
    right: [config.sticks[1][0]?.index ?? 2, config.sticks[1][1]?.index ?? 3],
    dpadButtons: dpadButtons.every((v) => v !== null) ? dpadButtons : null,
    buttons: config.buttons.map((b, i) => (b?.kind === "button" ? b.index : i)),
    /** 軸として割り当てられたボタン（トリガーが軸で届く機種向け） */
    buttonAxes: config.buttons.map((b) => (b?.kind === "axis" ? b : null)),
    /** 遊ぶ人が「使わない」と決めた方向 */
    cursorNone: config.cursor.map(unassigned),
    /** 同じくボタン */
    buttonNone: config.buttons.map(unassigned),
    /** 同じくスティックの軸 */
    stickNone: config.sticks.map((pair) => pair.map(unassigned)),
    /** スティックの向き（右・下を正とするための符号） */
    stickSigns: [
      [config.sticks[0][0]?.sign ?? 1, config.sticks[0][1]?.sign ?? 1],
      [config.sticks[1][0]?.sign ?? 1, config.sticks[1][1]?.sign ?? 1],
    ],
  };
}

/**
 * ゲームが使うと申告した操作だけに、手順を絞る
 *
 * `setGamepadOption use: {...}` で申告する。**書いた種類だけ**を尋ねるため、
 * 4方向とAボタンしか使わないゲームなら、遊ぶ人は2種類を設定するだけで済む。
 * 申告が無ければ、これまでどおり全20項目を尋ねる。
 */
export function stepsFor(use) {
  if (!use || typeof use !== "object" || Array.isArray(use)) return CONFIG_STEPS;

  const usesCursor = use.cursor === true;
  const buttons = new Set(Array.isArray(use.button) ? use.button : []);
  const sticks = new Set();
  for (const s of Array.isArray(use.stick) ? use.stick : []) {
    if (s === "left") sticks.add(0);
    if (s === "right") sticks.add(1);
  }

  // 申告の並び順ではなく、尋ねやすい元の順番を保つ
  return CONFIG_STEPS.filter((step) => {
    if (step.kind === "cursor") return usesCursor;
    if (step.kind === "button") return buttons.has(step.index);
    return sticks.has(step.stick);
  });
}

/**
 * 設定し直しの出発点を作る
 *
 * 保存済みの設定があれば引き継ぎ、**これから尋ねる項目だけ**を空に戻す。
 * こうしておくと、一部の項目だけ設定し直しても、
 * 尋ねなかった項目の割り当てを失わずに済む。
 */
export function startConfig(name, key, saved, steps) {
  const config = createConfig(name, key);

  if (saved) {
    // 元を書き換えないよう、写しを取る
    config.cursor = [...(saved.cursor ?? config.cursor)];
    config.hatAxis = saved.hatAxis ?? null;
    config.buttons = [...(saved.buttons ?? config.buttons)];
    config.sticks = (saved.sticks ?? config.sticks).map((pair) => [...pair]);
  }

  let asksCursor = false;
  for (const step of steps ?? CONFIG_STEPS) {
    if (step.kind === "cursor") {
      config.cursor[step.index] = null;
      asksCursor = true;
    } else if (step.kind === "button") {
      config.buttons[step.index] = null;
    } else {
      config.sticks[step.stick][step.axis] = null;
    }
  }
  // 4方向を尋ね直すなら、ハットスイッチの見立ても取り直す
  if (asksCursor) config.hatAxis = null;

  return config;
}

/** そのゲーム専用の保存場所 */
export function storageKey(url) {
  const text = typeof url === "string" ? url : "";
  // 問い合わせ文字列や場所指定は、同じゲームとして扱う
  const base = text.split("?")[0].split("#")[0];
  return `${STORAGE_PREFIX}:${base}`;
}

/** そのゲームの設定をすべて読む */
function readAll(url) {
  try {
    const text = globalThis.localStorage?.getItem(storageKey(url));
    return text ? JSON.parse(text) : {};
  } catch {
    // 読めない場合は、設定が無いものとして扱う
    return {};
  }
}

/** 設定を保存する */
export function saveGamepadConfig(config, url) {
  if (!config?.key) return false;
  try {
    const all = readAll(url);
    all[config.key] = config;
    globalThis.localStorage?.setItem(storageKey(url), JSON.stringify(all));
    return true;
  } catch {
    // 保存できない環境（プライベートモード等）でも、その回の設定は使える
    return false;
  }
}

/** 設定を読み出す（無ければ null） */
export function loadGamepadConfig(key, url) {
  return readAll(url)[key] ?? null;
}

/** 設定を消す */
export function clearGamepadConfig(key, url) {
  try {
    const all = readAll(url);
    delete all[key];
    globalThis.localStorage?.setItem(storageKey(url), JSON.stringify(all));
  } catch {
    // 消せなくても実害はない
  }
}

/** 中立の値（gamepad.js と共有） */
export { HAT_NEUTRAL };

// ゲームコントローラーの状態づくりのテスト
import { beforeEach, describe, expect, test } from "bun:test";

import {
  GAMEPAD,
  HAT_NEUTRAL,
  decodeHat,
  parseGamepadId,
  resolveLayout,
  PRESETS,
  CURSOR_UP,
  CURSOR_RIGHT,
  CURSOR_DOWN,
  CURSOR_LEFT,
  CURSOR_KEYS,
  BUTTON_KEYS,
  BUTTON_COUNT,
  applyGamepads,
  clearGamepads,
  setGamepadOption,
  gamepadOption,
  DEFAULT_DEADZONE,
} from "../web/gamepad.js";

const near = (a, b, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

/** XInput 相当の生データを作る */
function rawPad({ buttons = {}, dpad = {}, axes = [0, 0, 0, 0] } = {}) {
  const list = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  for (const [i, v] of Object.entries(buttons)) {
    list[Number(i)] = typeof v === "number" ? { pressed: v > 0, value: v } : { pressed: true, value: 1 };
  }
  const DPAD = { up: 12, down: 13, left: 14, right: 15 };
  for (const [name, on] of Object.entries(dpad)) {
    if (on) list[DPAD[name]] = { pressed: true, value: 1 };
  }
  return { buttons: list, axes, mapping: "standard" };
}

/**
 * DirectInput のパッドの生データを作る（エレコム JC-U3613M 実測の配置）
 *
 * 軸 0,1 が左スティック、2,5 が右スティック、9 がハットスイッチ。
 */
function dinputPad({ buttons = {}, hat = HAT_NEUTRAL, left = [0, 0], right = [0, 0] } = {}) {
  const list = Array.from({ length: 13 }, () => ({ pressed: false, value: 0 }));
  for (const [i, v] of Object.entries(buttons)) {
    list[Number(i)] = typeof v === "number" ? { pressed: v > 0, value: v } : { pressed: true, value: 1 };
  }
  const axes = [left[0], left[1], right[0], 0, 0, right[1], 0, 0, 0, hat];
  return {
    buttons: list,
    axes,
    mapping: "",
    id: "JC-U3613M - DirectInput Mode (Vendor: 056e Product: 2003)",
  };
}

beforeEach(() => {
  clearGamepads();
  setGamepadOption({ stickAsCursor: false, deadzone: DEFAULT_DEADZONE });
});

describe("並び順の決まり", () => {
  test("cursor は 上・右・下・左 の順", () => {
    expect([CURSOR_UP, CURSOR_RIGHT, CURSOR_DOWN, CURSOR_LEFT]).toEqual([0, 1, 2, 3]);
  });

  test("cursor のキーボード割り当て", () => {
    expect(CURSOR_KEYS[CURSOR_UP]).toEqual(["ArrowUp", "KeyW"]);
    expect(CURSOR_KEYS[CURSOR_RIGHT]).toEqual(["ArrowRight", "KeyD"]);
    expect(CURSOR_KEYS[CURSOR_DOWN]).toEqual(["ArrowDown", "KeyS"]);
    expect(CURSOR_KEYS[CURSOR_LEFT]).toEqual(["ArrowLeft", "KeyA"]);
  });

  test("button は12個で、キーボードは yuiohjklnm と読点・句点", () => {
    expect(BUTTON_COUNT).toBe(12);
    expect(BUTTON_KEYS).toEqual([
      "KeyY", "KeyU", "KeyI", "KeyO",
      "KeyH", "KeyJ", "KeyK", "KeyL",
      "KeyN", "KeyM", "Comma", "Period",
    ]);
  });
});

describe("何も繋がっていない場合", () => {
  test("キーボード用に1つだけ用意する", () => {
    applyGamepads([], new Set());
    expect(GAMEPAD.length).toBe(1);
  });

  test("押していなければすべて false", () => {
    applyGamepads([], new Set());
    for (const c of GAMEPAD[0].cursor) expect(c.pressed).toBe(false);
    for (const b of GAMEPAD[0].button) expect(b.pressed).toBe(false);
    expect(GAMEPAD[0].axes).toEqual([[0, 0], [0, 0]]);
  });

  test("形がそろっている", () => {
    applyGamepads([], new Set());
    expect(GAMEPAD[0].cursor.length).toBe(4);
    expect(GAMEPAD[0].button.length).toBe(12);
    expect(GAMEPAD[0].axes.length).toBe(2);
    expect(GAMEPAD[0].axes[0].length).toBe(2);
  });
});

describe("キーボードの反映", () => {
  test("カーソルキーで cursor が立つ", () => {
    applyGamepads([], new Set(["ArrowUp"]));
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
    expect(GAMEPAD[0].cursor[CURSOR_DOWN].pressed).toBe(false);
  });

  test("WASD でも同じところが立つ", () => {
    applyGamepads([], new Set(["KeyW"]));
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
    applyGamepads([], new Set(["KeyA"]));
    expect(GAMEPAD[0].cursor[CURSOR_LEFT].pressed).toBe(true);
  });

  test("yuihjknm と読点で button が立つ", () => {
    BUTTON_KEYS.forEach((code, i) => {
      applyGamepads([], new Set([code]));
      expect(GAMEPAD[0].button[i].pressed).toBe(true);
      expect(GAMEPAD[0].button[i].value).toBe(1);
    });
  });

  test("キーボードは GAMEPAD[0] にだけ混ざる", () => {
    applyGamepads([rawPad(), rawPad()], new Set(["KeyY"]));
    expect(GAMEPAD[0].button[0].pressed).toBe(true);
    expect(GAMEPAD[1].button[0].pressed).toBe(false);
  });
});

describe("ゲームパッドの反映", () => {
  test("4方向キーが cursor に入る", () => {
    applyGamepads([rawPad({ dpad: { right: true } })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_RIGHT].pressed).toBe(true);
    expect(GAMEPAD[0].cursor[CURSOR_LEFT].pressed).toBe(false);
  });

  test("ボタン12個が button に入る", () => {
    applyGamepads([rawPad({ buttons: { 0: 1, 11: 1 } })], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(true);
    expect(GAMEPAD[0].button[11].pressed).toBe(true);
    expect(GAMEPAD[0].button[1].pressed).toBe(false);
  });

  test("アナログボタンは value に入る", () => {
    applyGamepads([rawPad({ buttons: { 6: 0.4 } })], new Set());
    near(GAMEPAD[0].button[6].value, 0.4);
    expect(GAMEPAD[0].button[6].pressed).toBe(true);
  });

  test("スティックは 左右 × XY の順で入る", () => {
    applyGamepads([rawPad({ axes: [-1, 0.5, 0.25, -0.75] })], new Set());
    expect(GAMEPAD[0].axes[0]).toEqual([-1, 0.5]);
    expect(GAMEPAD[0].axes[1]).toEqual([0.25, -0.75]);
  });

  test("スティックの値は -1〜1 に収める", () => {
    applyGamepads([rawPad({ axes: [-9, 9, 0, 0] })], new Set());
    expect(GAMEPAD[0].axes[0]).toEqual([-1, 1]);
  });

  test("軸が足りないパッドでも落ちない", () => {
    applyGamepads([{ buttons: [], axes: [0.5] }], new Set());
    expect(GAMEPAD[0].axes[0]).toEqual([0.5, 0]);
    expect(GAMEPAD[0].axes[1]).toEqual([0, 0]);
  });

  test("末尾の空き枠は数えない", () => {
    // getGamepads() は未接続でも4枠返すため、そのままだと空の要素が並んでしまう
    applyGamepads([rawPad(), null, null, null], new Set());
    expect(GAMEPAD.length).toBe(1);
  });

  test("間の空き枠は残して添字をそろえる", () => {
    applyGamepads([null, rawPad({ buttons: { 0: 1 } }), null], new Set());
    expect(GAMEPAD.length).toBe(2);
    expect(GAMEPAD[1].button[0].pressed).toBe(true);
  });

  test("繋がっていない枠は飛ばす", () => {
    applyGamepads([null, rawPad({ buttons: { 0: 1 } })], new Set());
    expect(GAMEPAD.length).toBe(2);
    expect(GAMEPAD[1].button[0].pressed).toBe(true);
  });
});

describe("混ざり方", () => {
  test("どちらかが押されていれば押されている扱い", () => {
    applyGamepads([rawPad()], new Set(["KeyY"]));
    expect(GAMEPAD[0].button[0].pressed).toBe(true);
    applyGamepads([rawPad({ buttons: { 0: 1 } })], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(true);
  });

  test("value は大きいほうを採る", () => {
    // キーボードは 1、パッドは 0.3 → 1 になる
    applyGamepads([rawPad({ buttons: { 0: 0.3 } })], new Set(["KeyY"]));
    expect(GAMEPAD[0].button[0].value).toBe(1);
  });

  test("離すと戻る", () => {
    applyGamepads([], new Set(["KeyY"]));
    applyGamepads([], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(false);
    expect(GAMEPAD[0].button[0].value).toBe(0);
  });
});

describe("実体の保ち方", () => {
  test("更新しても配列を作り直さない", () => {
    applyGamepads([], new Set());
    const before = GAMEPAD;
    const pad = GAMEPAD[0];
    applyGamepads([rawPad()], new Set(["KeyY"]));
    // 受け取った側が古いものを見続けないようにする
    expect(GAMEPAD).toBe(before);
    expect(GAMEPAD[0]).toBe(pad);
  });

  test("パッドが減ったら要素も減る", () => {
    applyGamepads([rawPad(), rawPad()], new Set());
    expect(GAMEPAD.length).toBe(2);
    applyGamepads([rawPad()], new Set());
    expect(GAMEPAD.length).toBe(1);
  });

  test("空にできる", () => {
    applyGamepads([rawPad(), rawPad()], new Set(["KeyY"]));
    clearGamepads();
    expect(GAMEPAD.length).toBe(1);
    expect(GAMEPAD[0].button[0].pressed).toBe(false);
  });
});

describe("ハットスイッチの読み取り", () => {
  test("中立ではどこも押されていない", () => {
    expect(decodeHat(HAT_NEUTRAL)).toEqual([false, false, false, false]);
  });

  test("8方向を読み分ける", () => {
    // 上・右・下・左 の順
    expect(decodeHat(-1)).toEqual([true, false, false, false]);
    expect(decodeHat(-0.714)).toEqual([true, true, false, false]);
    expect(decodeHat(-0.429)).toEqual([false, true, false, false]);
    expect(decodeHat(-0.143)).toEqual([false, true, true, false]);
    expect(decodeHat(0.143)).toEqual([false, false, true, false]);
    expect(decodeHat(0.429)).toEqual([false, false, true, true]);
    expect(decodeHat(0.714)).toEqual([false, false, false, true]);
    expect(decodeHat(1.0)).toEqual([true, false, false, true]);
  });

  test("範囲の外や数値以外は中立にする", () => {
    expect(decodeHat(9)).toEqual([false, false, false, false]);
    expect(decodeHat(undefined)).toEqual([false, false, false, false]);
    expect(decodeHat("上")).toEqual([false, false, false, false]);
  });
});

describe("標準ではない配置（DirectInput）", () => {
  test("ハットスイッチが cursor に入る", () => {
    applyGamepads([dinputPad({ hat: -1 })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
    expect(GAMEPAD[0].cursor[CURSOR_DOWN].pressed).toBe(false);

    applyGamepads([dinputPad({ hat: -0.429 })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_RIGHT].pressed).toBe(true);
  });

  test("斜めは2方向が同時に立つ", () => {
    applyGamepads([dinputPad({ hat: -0.714 })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
    expect(GAMEPAD[0].cursor[CURSOR_RIGHT].pressed).toBe(true);
  });

  test("中立ではどこも立たない", () => {
    applyGamepads([dinputPad()], new Set());
    for (const c of GAMEPAD[0].cursor) expect(c.pressed).toBe(false);
  });

  test("左スティックは 0 と 1、右スティックは 2 と 5 から取る", () => {
    applyGamepads([dinputPad({ left: [-1, 0.5], right: [0.25, -0.75] })], new Set());
    expect(GAMEPAD[0].axes[0]).toEqual([-1, 0.5]);
    expect(GAMEPAD[0].axes[1]).toEqual([0.25, -0.75]);
  });

  test("ボタンは先頭12個を使う", () => {
    // この機種はボタンが13個あるが、扱うのは先頭12個まで
    applyGamepads([dinputPad({ buttons: { 0: 1, 11: 1, 12: 1 } })], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(true);
    expect(GAMEPAD[0].button[11].pressed).toBe(true);
    expect(GAMEPAD[0].button.length).toBe(12);
  });

  test("キーボードも同じように混ざる", () => {
    applyGamepads([dinputPad()], new Set(["ArrowUp", "KeyY"]));
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
    expect(GAMEPAD[0].button[0].pressed).toBe(true);
  });

  test("ハットが無ければ4方向キーのボタンから取る", () => {
    // 標準ではないが、方向がボタンとして来る機種もある
    const pad = { buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })), axes: [0, 0], mapping: "" };
    pad.buttons[15] = { pressed: true, value: 1 };
    applyGamepads([pad], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_RIGHT].pressed).toBe(true);
  });
});

describe("製造元の読み取り", () => {
  test("Chrome の書き方から取り出す", () => {
    const r = parseGamepadId("JC-U3613M - DirectInput Mode (Vendor: 056e Product: 2003)");
    expect(r.vendor).toBe("056e");
    expect(r.product).toBe("2003");
  });

  test("Firefox の書き方からも取り出す", () => {
    const r = parseGamepadId("056e-2003-JC-U3613M");
    expect(r.vendor).toBe("056e");
    expect(r.product).toBe("2003");
  });

  test("大文字で書かれていても揃える", () => {
    expect(parseGamepadId("(Vendor: 056E Product: 2003)").vendor).toBe("056e");
  });

  test("読み取れない場合は null", () => {
    expect(parseGamepadId("Unknown Gamepad").vendor).toBeNull();
    expect(parseGamepadId(undefined).vendor).toBeNull();
  });
});

describe("配置の決め方", () => {
  test("標準と名乗るものは標準の配置を使う", () => {
    const layout = resolveLayout({ mapping: "standard", id: "Xbox Wireless Controller", axes: [0, 0, 0, 0] });
    expect(layout.source).toBe("standard");
    expect(layout.right).toEqual([2, 3]);
    expect(layout.hatAxis).toBeNull();
  });

  test("登録済みの機種はプリセットを使う", () => {
    const layout = resolveLayout(dinputPad());
    expect(layout.source).toBe("preset");
    expect(layout.name).toContain("JC-U3613M");
    expect(layout.hatAxis).toBe(9);
    expect(layout.right).toEqual([2, 5]);
  });

  test("プリセットは製造元と製品の両方で引く", () => {
    expect(PRESETS["056e:2003"]).toBeDefined();
  });

  test("知らない機種は、その場で見当をつける", () => {
    // 中立のハット（1.286）が出ている軸をハットとみなす
    const pad = {
      mapping: "",
      id: "Unknown Pad (Vendor: 9999 Product: 0001)",
      buttons: [],
      axes: [0, 0, 0, 0, 0, 0, HAT_NEUTRAL],
    };
    const layout = resolveLayout(pad);
    expect(layout.source).toBe("guess");
    expect(layout.hatAxis).toBe(6);
  });

  test("ハットが見当たらなければ、方向はボタンから取る", () => {
    const pad = { mapping: "", id: "Unknown", buttons: [], axes: [0, 0, 0, 0] };
    const layout = resolveLayout(pad);
    expect(layout.hatAxis).toBeNull();
    expect(layout.dpadButtons).toEqual([12, 15, 13, 14]);
  });
});

describe("左スティックを4方向キーとして扱う設定", () => {
  /** 左スティックだけを倒した標準配置のパッド */
  const stick = (x, y) => rawPad({ axes: [x, y, 0, 0] });

  test("既定では混ざらない", () => {
    expect(gamepadOption().stickAsCursor).toBe(false);
    applyGamepads([stick(0, -1)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(false);
  });

  test("しきい値の既定は 0.5", () => {
    expect(DEFAULT_DEADZONE).toBe(0.5);
    expect(gamepadOption().deadzone).toBe(0.5);
  });

  test("入にすると4方向として立つ", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([stick(0, -1)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);

    applyGamepads([stick(1, 0)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_RIGHT].pressed).toBe(true);

    applyGamepads([stick(0, 1)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_DOWN].pressed).toBe(true);

    applyGamepads([stick(-1, 0)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_LEFT].pressed).toBe(true);
  });

  test("斜めに倒すと2方向が立つ", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([stick(0.8, -0.8)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
    expect(GAMEPAD[0].cursor[CURSOR_RIGHT].pressed).toBe(true);
    expect(GAMEPAD[0].cursor[CURSOR_DOWN].pressed).toBe(false);
  });

  test("しきい値に届かない傾きでは立たない", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([stick(0, -0.4)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(false);
  });

  test("しきい値を変えられる", () => {
    setGamepadOption({ stickAsCursor: true, deadzone: 0.2 });
    applyGamepads([stick(0, -0.3)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
  });

  test("扱えないしきい値は無視する", () => {
    setGamepadOption({ deadzone: -1 });
    expect(gamepadOption().deadzone).toBe(DEFAULT_DEADZONE);
    setGamepadOption({ deadzone: "はんぶん" });
    expect(gamepadOption().deadzone).toBe(DEFAULT_DEADZONE);
  });

  test("4方向キーと混ざる（どちらでも立つ）", () => {
    setGamepadOption({ stickAsCursor: true });
    // 4方向キーだけ
    applyGamepads([rawPad({ dpad: { up: true } })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
    // スティックだけ
    applyGamepads([stick(0, -1)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
    // 両方
    applyGamepads([rawPad({ dpad: { up: true }, axes: [0, -1, 0, 0] })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
  });

  test("スティックの値そのものは残る", () => {
    // 4方向として使っても、axes からアナログ値を読めなくならない
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([stick(0.8, -0.8)], new Set());
    expect(GAMEPAD[0].axes[0]).toEqual([0.8, -0.8]);
  });

  test("右スティックは混ざらない", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([rawPad({ axes: [0, 0, 0, -1] })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(false);
  });

  test("標準ではない配置でも効く", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([dinputPad({ left: [0, -1] })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
  });

  test("設定は書いた項目だけ変わる", () => {
    setGamepadOption({ stickAsCursor: true, deadzone: 0.3 });
    setGamepadOption({ deadzone: 0.7 });
    expect(gamepadOption().stickAsCursor).toBe(true);
    expect(gamepadOption().deadzone).toBe(0.7);
  });
});

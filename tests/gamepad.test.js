// ゲームコントローラーの状態づくりのテスト
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

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
  setConfigLookup,
  setGamepadSuspended,
  gamepadSuspended,
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
    // 端に張り付いた軸は「まだ値が届いていない」とみなすため、
    // 倒しきった状態を見せる前に、一度静止状態を見せる
    applyGamepads([rawPad()], new Set());
    applyGamepads([rawPad({ axes: [-1, 0.5, 0.25, -0.75] })], new Set());
    expect(GAMEPAD[0].axes[0]).toEqual([-1, 0.5]);
    expect(GAMEPAD[0].axes[1]).toEqual([0.25, -0.75]);
  });

  test("スティックの値は -1〜1 に収める", () => {
    applyGamepads([rawPad()], new Set());
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
    applyGamepads([dinputPad()], new Set());
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

  /**
   * 静止状態を1度見せてから倒す
   *
   * 静止位置は**最初に見えた時の値**で決まるため、
   * いきなり倒した状態を渡すとそれが静止位置になってしまう。
   */
  const tilt = (x, y) => {
    applyGamepads([stick(0, 0)], new Set());
    applyGamepads([stick(x, y)], new Set());
  };

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
    tilt(0, -1);
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
    tilt(0.8, -0.8);
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
    tilt(0, -0.3);
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
    applyGamepads([stick(0, 0)], new Set());
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
    tilt(0.8, -0.8);
    expect(GAMEPAD[0].axes[0]).toEqual([0.8, -0.8]);
  });

  test("右スティックは混ざらない", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([stick(0, 0)], new Set());
    applyGamepads([rawPad({ axes: [0, 0, 0, -1] })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(false);
  });

  test("標準ではない配置でも効く", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([dinputPad()], new Set());
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

describe("静止位置が0でない軸への対応", () => {
  /** 静止時に軸1が -1 になる機種（実機で確認: 11ff:9608） */
  const oddPad = (axes) => ({ mapping: "standard", id: "Odd (Vendor: 11ff Product: 9608)", buttons: [], axes });

  test("静止したままなら、どの方向も押されない", () => {
    // 軸1が -1 のまま。これを「上へ倒しっぱなし」と読んではいけない
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([oddPad([0, -1, 0, 0])], new Set());
    for (const c of GAMEPAD[0].cursor) expect(c.pressed).toBe(false);
  });

  test("値が届いたあとは、上下とも普通に反応する", () => {
    setGamepadOption({ stickAsCursor: true });
    // -1 のままの間は「まだ値が届いていない」。中間の値が来て初めて動き出す
    applyGamepads([oddPad([0, -1, 0, 0])], new Set());
    applyGamepads([oddPad([0, 0, 0, 0])], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_DOWN].pressed).toBe(false);
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(false);

    applyGamepads([oddPad([0, -1, 0, 0])], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);

    applyGamepads([oddPad([0, 1, 0, 0])], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_DOWN].pressed).toBe(true);
  });

  test("左右は静止位置が0なら今までどおり", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([oddPad([0, -1, 0, 0])], new Set());
    applyGamepads([oddPad([-1, -1, 0, 0])], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_LEFT].pressed).toBe(true);
  });

  test("普通の機種（静止0）はこれまでと同じ", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([rawPad({ axes: [0, 0, 0, 0] })], new Set());
    applyGamepads([rawPad({ axes: [0, -1, 0, 0] })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
  });

  test("基準は実行のたびに取り直す", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([oddPad([0, -1, 0, 0])], new Set());
    clearGamepads();
    setGamepadOption({ stickAsCursor: true });
    // 新しい静止位置（0）を基準にする
    applyGamepads([rawPad({ axes: [0, 0, 0, 0] })], new Set());
    applyGamepads([rawPad({ axes: [0, -1, 0, 0] })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
  });

  test("軸の数が変わったら基準を取り直す", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([oddPad([0, -1, 0, 0])], new Set());
    // 別の機種に差し替わった場合
    applyGamepads([{ mapping: "standard", id: "other", buttons: [], axes: [0, 0, 0, 0, 0, 0] }], new Set());
    for (const c of GAMEPAD[0].cursor) expect(c.pressed).toBe(false);
  });
});

describe("配置の判定は一度だけ行う", () => {
  /** PXN-P20 実測: 軸1,2,5 は静止時 -1、軸9 がハット（中立 -1.286） */
  // 実機は mapping が空（標準配置ではない）
  const pxn = (axes) => ({
    mapping: "",
    id: "PXN-P20 (Vendor: 11ff Product: 9608)",
    buttons: Array.from({ length: 13 }, () => ({ pressed: false, value: 0 })),
    axes,
  });
  const rest = [0, -1, -1, 0, 0, -1, 0, 0, 0, -1.286];
  const hat = (v) => { const a = [...rest]; a[9] = v; return a; };

  test("押している間もハットを見失わない", () => {
    // 押すと軸9が範囲内に入るため、毎フレーム判定し直すと見失う
    applyGamepads([pxn(rest)], new Set());
    applyGamepads([pxn(hat(-1))], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);

    applyGamepads([pxn(hat(-0.429))], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_RIGHT].pressed).toBe(true);

    applyGamepads([pxn(hat(0.143))], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_DOWN].pressed).toBe(true);

    applyGamepads([pxn(hat(0.714))], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_LEFT].pressed).toBe(true);
  });

  test("離せば中立へ戻る", () => {
    applyGamepads([pxn(rest)], new Set());
    applyGamepads([pxn(hat(-1))], new Set());
    applyGamepads([pxn(rest)], new Set());
    for (const c of GAMEPAD[0].cursor) expect(c.pressed).toBe(false);
  });

  test("軸の数が変わったら判定し直す", () => {
    applyGamepads([pxn(rest)], new Set());
    applyGamepads([rawPad({ dpad: { up: true } })], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
  });
});

describe("スティックに使う軸の選び方", () => {
  const pxn = (axes) => ({
    mapping: "",
    id: "PXN-P20 (Vendor: 11ff Product: 9608)",
    buttons: [],
    axes,
  });
  const rest = [0, -1, -1, 0, 0, -1, 0, 0, 0, -1.286];

  test("静止時に端へ張り付いている軸は、スティックに使わない", () => {
    // 軸1・2・5 は静止時 -1。上方向を表現できないため選んではいけない
    const layout = resolveLayout(pxn(rest));
    expect(layout.left).not.toContain(1);
    expect(layout.right).not.toContain(1);
  });

  test("静止時に0付近の軸から順に割り当てる", () => {
    const layout = resolveLayout(pxn(rest));
    // ハット（軸9）を除いた、静止0の軸は 0,3,4,6,7,8
    expect(layout.left).toEqual([0, 3]);
    expect(layout.right).toEqual([4, 6]);
  });

  test("上へ倒せば上が立つ", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([pxn(rest)], new Set());
    const up = [...rest];
    up[3] = -1;
    applyGamepads([pxn(up)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
  });

  test("普通の機種は今までどおり先頭から割り当てる", () => {
    const layout = resolveLayout({ mapping: "", id: "x", buttons: [], axes: [0, 0, 0, 0, 0, 0] });
    expect(layout.left).toEqual([0, 1]);
    expect(layout.right).toEqual([2, 5]);
  });
});

describe("遊ぶ人の設定を最優先で使う", () => {
  /** 遊ぶ人が作った割り当て */
  const option = {
    name: "PXN-P20",
    source: "config",
    hatAxis: 9,
    left: [0, 3],
    right: [4, 6],
    dpadButtons: null,
    buttons: [2, 0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    buttonAxes: new Array(12).fill(null),
    stickSigns: [[1, 1], [1, 1]],
  };
  const pad = (axes, pressed = []) => ({
    mapping: "standard",
    id: "PXN-P20 (Vendor: 11ff Product: 9608)",
    axes,
    buttons: Array.from({ length: 13 }, (_, i) => ({
      pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0,
    })),
  });
  const rest = [0, -1, -1, 0, 0, -1, 0, 0, 0, -1.286];

  test("設定があれば、標準と名乗る機種でもそちらを使う", () => {
    setConfigLookup(() => option);
    applyGamepads([pad(rest)], new Set());
    // 標準配置なら 4方向はボタン12〜15。設定ではハット軸9
    const up = [...rest]; up[9] = -1;
    applyGamepads([pad(up)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
    setConfigLookup(null);
  });

  test("ボタンの割り当てが入れ替わる", () => {
    setConfigLookup(() => option);
    // 設定では button[0] に、パッドの2番を当てている
    applyGamepads([pad(rest, [2])], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(true);
    expect(GAMEPAD[0].button[2].pressed).toBe(false);
    setConfigLookup(null);
  });

  test("スティックの軸も設定どおりになる", () => {
    setConfigLookup(() => option);
    const a = [...rest]; a[3] = 0.5;
    applyGamepads([pad(a)], new Set());
    expect(GAMEPAD[0].axes[0][1]).toBe(0.5);
    setConfigLookup(null);
  });

  test("設定が無ければ、これまでどおりの判定になる", () => {
    setConfigLookup(() => null);
    applyGamepads([pad(rest)], new Set());
    const up = [...rest]; up[9] = -1;
    applyGamepads([pad(up)], new Set());
    // 標準と名乗る機種なので、ハットは使われない
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(false);
    setConfigLookup(null);
  });

  test("向きを反転して覚えた軸は、符号をそろえて返す", () => {
    setConfigLookup(() => ({ ...option, stickSigns: [[1, -1], [1, 1]] }));
    const a = [...rest]; a[3] = -0.5;
    applyGamepads([pad(a)], new Set());
    // 「下へ倒すと -1 になる」機種なので、下は正の値として返す
    expect(GAMEPAD[0].axes[0][1]).toBe(0.5);
    setConfigLookup(null);
  });
});

describe("触るまで端に張り付く軸を持つ機種", () => {
  /**
   * 実機（PXN-P20）の癖
   *
   * 左スティックの上下軸は、**一度も触られていない間 -1 を返し続ける**。
   * 一度でも動かすと 0 を静止位置として正しく返すようになる。
   *
   * これを「上に倒しっぱなし」と読んでしまうと、
   * 何もしていないのに動き続け、上に倒しても値が変わらない。
   */
  const option = {
    name: "PXN-P20",
    source: "config",
    hatAxis: 9,
    left: [0, 1],
    right: [3, 4],
    dpadButtons: null,
    buttons: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    buttonAxes: new Array(12).fill(null),
    stickSigns: [[1, 1], [1, 1]],
  };
  /** 左スティックの上下（軸1）だけを変えた生データ */
  const pxn = (y) => ({
    mapping: "",
    id: "PXN-P20 (Vendor: 11ff Product: 9608)",
    buttons: [],
    axes: [0, y, -1, 0, 0, -1, 0, 0, 0, -1.286],
  });

  beforeEach(() => {
    setConfigLookup(() => option);
  });

  afterEach(() => {
    setConfigLookup(null);
  });

  test("触る前は 0 として返す（倒しっぱなしと読まない）", () => {
    applyGamepads([pxn(-1)], new Set());
    expect(GAMEPAD[0].axes[0]).toEqual([0, 0]);
  });

  test("一度中間の値が来たら、以後はそのまま返す", () => {
    applyGamepads([pxn(-1)], new Set()); // 触る前
    applyGamepads([pxn(0)], new Set()); // 触って静止位置が出た
    expect(GAMEPAD[0].axes[0]).toEqual([0, 0]);

    applyGamepads([pxn(-1)], new Set()); // 上へ倒す
    expect(GAMEPAD[0].axes[0]).toEqual([0, -1]);

    applyGamepads([pxn(1)], new Set()); // 下へ倒す
    expect(GAMEPAD[0].axes[0]).toEqual([0, 1]);

    applyGamepads([pxn(0)], new Set()); // 手を離す
    expect(GAMEPAD[0].axes[0]).toEqual([0, 0]);
  });

  test("倒す途中の値でも張り付きは解ける", () => {
    applyGamepads([pxn(-1)], new Set());
    applyGamepads([pxn(-0.3)], new Set()); // 上へ倒し始めた
    expect(GAMEPAD[0].axes[0][1]).toBe(-0.3);
    applyGamepads([pxn(-1)], new Set());
    expect(GAMEPAD[0].axes[0][1]).toBe(-1);
  });

  test("4方向キーへ混ぜる設定でも、触る前は立たない", () => {
    setGamepadOption({ stickAsCursor: true });
    applyGamepads([pxn(-1)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(false);
    expect(GAMEPAD[0].cursor[CURSOR_DOWN].pressed).toBe(false);

    applyGamepads([pxn(0)], new Set());
    applyGamepads([pxn(-1)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
  });

  test("ゲームを実行し直すと、張り付きの見立ても取り直す", () => {
    applyGamepads([pxn(-1)], new Set());
    applyGamepads([pxn(0)], new Set());
    clearGamepads();
    setConfigLookup(() => option);
    applyGamepads([pxn(-1)], new Set());
    expect(GAMEPAD[0].axes[0]).toEqual([0, 0]);
  });

  test("端に張り付いていない軸は、これまでどおりそのまま返す", () => {
    applyGamepads([pxn(0)], new Set());
    const a = pxn(0);
    a.axes[0] = -0.6;
    applyGamepads([a], new Set());
    expect(GAMEPAD[0].axes[0][0]).toBe(-0.6);
  });

  test("軸で届くトリガーは、静止時に押されていない", () => {
    // 軸2は静止時 -1、押し込むと +1 になる
    const option = {
      name: "PXN-P20",
      source: "config",
      hatAxis: 9,
      left: [0, 1],
      right: [3, 4],
      dpadButtons: null,
      buttons: [0, 1, 2, 3, 4, 5, null, null, 8, 9, 10, 11],
      buttonAxes: [
        null, null, null, null, null, null,
        { index: 2, sign: 1 }, null, null, null, null, null,
      ],
      stickSigns: [[1, 1], [1, 1]],
    };
    setConfigLookup(() => option);
    applyGamepads([pxn(0)], new Set());
    expect(GAMEPAD[0].button[6].pressed).toBe(false);

    const pressed = pxn(0);
    pressed.axes[2] = 1;
    applyGamepads([pressed], new Set());
    expect(GAMEPAD[0].button[6].pressed).toBe(true);
  });
});

describe("使わないと決めた操作", () => {
  /** 設定で「使わない」と決めた配置 */
  const option = {
    name: "Test",
    source: "config",
    hatAxis: 9,
    left: [0, 1],
    right: [2, 5],
    dpadButtons: null,
    buttons: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    buttonAxes: new Array(12).fill(null),
    stickSigns: [[1, 1], [1, 1]],
    cursorNone: [true, false, false, false],
    buttonNone: [false, true, false, false, false, false, false, false, false, false, false, false],
    stickNone: [[false, true], [false, false]],
  };
  const pad = (axes, pressed = []) => ({
    mapping: "",
    id: "Test (Vendor: 1234 Product: 5678)",
    axes,
    buttons: Array.from({ length: 13 }, (_, i) => ({
      pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0,
    })),
  });
  const rest = [0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_NEUTRAL];

  beforeEach(() => {
    setConfigLookup(() => option);
  });

  afterEach(() => {
    setConfigLookup(null);
  });

  test("使わない方向は、ハットを倒しても押されない", () => {
    applyGamepads([pad(rest)], new Set());
    const up = [...rest]; up[9] = -1;
    applyGamepads([pad(up)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(false);
    // 使う方向はこれまでどおり
    const down = [...rest]; down[9] = 0;
    applyGamepads([pad(down)], new Set());
    expect(GAMEPAD[0].cursor[CURSOR_DOWN].pressed).toBe(true);
  });

  test("使わない方向でも、キーボードでは操作できる", () => {
    // 遊ぶ人がパッドで使わないだけで、ゲームがその方向を捨てたわけではない
    applyGamepads([pad(rest)], new Set(["ArrowUp"]));
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(true);
  });

  test("使わないボタンは、押しても反応しない", () => {
    applyGamepads([pad(rest, [1])], new Set());
    expect(GAMEPAD[0].button[1].pressed).toBe(false);
    applyGamepads([pad(rest, [0])], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(true);
  });

  test("使わないスティックの軸は、倒しても 0 のまま", () => {
    applyGamepads([pad(rest)], new Set());
    const tilt = [...rest]; tilt[0] = 0.5; tilt[1] = 0.9;
    applyGamepads([pad(tilt)], new Set());
    expect(GAMEPAD[0].axes[0]).toEqual([0.5, 0]);
  });
});

describe("ゲームが使う操作の宣言", () => {
  test("既定では宣言が無い", () => {
    expect(gamepadOption().use).toBeNull();
  });

  test("書いたものが残る", () => {
    setGamepadOption({ use: { cursor: true, button: [0, 1], stick: ["left"] } });
    expect(gamepadOption().use).toEqual({ cursor: true, button: [0, 1], stick: ["left"] });
  });

  test("扱えない値は宣言そのものを無視する", () => {
    setGamepadOption({ use: "ぜんぶ" });
    expect(gamepadOption().use).toBeNull();
  });

  test("実行し直すと宣言は消える", () => {
    setGamepadOption({ use: { button: [0] } });
    clearGamepads();
    expect(gamepadOption().use).toBeNull();
  });

  test("他の設定と一緒に書ける", () => {
    setGamepadOption({ stickAsCursor: true, use: { cursor: true } });
    expect(gamepadOption().stickAsCursor).toBe(true);
    expect(gamepadOption().use).toEqual({ cursor: true });
  });
});

describe("設定中は操作をゲームへ送らない", () => {
  /** ハットスイッチを持つ機種 */
  const hatPad = (pressed = []) => ({
    mapping: "",
    id: "Test (Vendor: 1234 Product: 5678)",
    axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_NEUTRAL],
    buttons: Array.from({ length: 13 }, (_, i) => ({
      pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0,
    })),
  });

  afterEach(() => {
    setGamepadSuspended(false);
    setConfigLookup(null);
  });

  test("既定では止めていない", () => {
    expect(gamepadSuspended()).toBe(false);
  });

  test("止めている間は、パッドを操作しても押されていない扱いになる", () => {
    const moved = () => rawPad({ buttons: { 0: 1 }, dpad: { up: true }, axes: [0.8, 0.8, 0, 0] });
    applyGamepads([rawPad()], new Set());
    applyGamepads([moved()], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(true);

    setGamepadSuspended(true);
    applyGamepads([moved()], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(false);
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(false);
    expect(GAMEPAD[0].axes[0]).toEqual([0, 0]);
  });

  test("止めている間は、キーボードも送らない", () => {
    setGamepadSuspended(true);
    applyGamepads([], new Set(["KeyY", "ArrowUp"]));
    expect(GAMEPAD[0].button[0].pressed).toBe(false);
    expect(GAMEPAD[0].cursor[CURSOR_UP].pressed).toBe(false);
  });

  test("入れ物は作り直さない（ゲームが持っている参照が生きたまま）", () => {
    applyGamepads([rawPad()], new Set());
    const ref = GAMEPAD[0];
    setGamepadSuspended(true);
    applyGamepads([rawPad({ buttons: { 0: 1 } })], new Set());
    expect(GAMEPAD[0]).toBe(ref);
  });

  test("止めるのをやめると、また効く", () => {
    setGamepadSuspended(true);
    applyGamepads([rawPad({ buttons: { 0: 1 } })], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(false);

    setGamepadSuspended(false);
    applyGamepads([rawPad({ buttons: { 0: 1 } })], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(true);
  });

  test("止めるのをやめた時、配置の見立てを取り直す", () => {
    // 設定中に割り当てが変わるため、覚えていた見立てを捨てる必要がある
    applyGamepads([hatPad()], new Set());
    applyGamepads([hatPad([2])], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(false);

    setGamepadSuspended(true);
    setConfigLookup(() => ({
      name: "決めたもの", source: "config", hatAxis: 9,
      left: [0, 1], right: [2, 5], dpadButtons: null,
      buttons: [2, 1, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      buttonAxes: new Array(12).fill(null),
      stickSigns: [[1, 1], [1, 1]],
    }));
    setGamepadSuspended(false);

    applyGamepads([hatPad([2])], new Set());
    expect(GAMEPAD[0].button[0].pressed).toBe(true);
  });

  test("実行し直すと、止めた状態も解ける", () => {
    setGamepadSuspended(true);
    clearGamepads();
    expect(gamepadSuspended()).toBe(false);
  });
});

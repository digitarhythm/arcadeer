// ゲームパッドのキーコンフィグ（設定の作り方と保存）のテスト
import { beforeEach, describe, expect, test } from "bun:test";

import {
  CONFIG_STEPS,
  detectInput,
  buildLayoutFromConfig,
  createConfig,
  recordStep,
  isHatBinding,
  storageKey,
  saveGamepadConfig,
  loadGamepadConfig,
  clearGamepadConfig,
  UNASSIGNED,
  stepsFor,
  startConfig,
} from "../web/gamepad-config.js";

/** 生データを作る */
const pad = (axes = [0, 0, 0, 0], pressed = []) => ({
  id: "Test (Vendor: 1234 Product: 5678)",
  mapping: "",
  axes,
  buttons: Array.from({ length: 13 }, (_, i) => ({
    pressed: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  })),
});

/**
 * 実行環境に localStorage が無いため、最小の代役を用意する
 *
 * 本物と同じ呼び出し方になるようにして、保存の経路そのものを確かめる。
 */
function useFakeStorage() {
  const box = new Map();
  globalThis.localStorage = {
    getItem: (k) => (box.has(k) ? box.get(k) : null),
    setItem: (k, v) => box.set(k, String(v)),
    removeItem: (k) => box.delete(k),
    clear: () => box.clear(),
  };
}

beforeEach(() => {
  useFakeStorage();
});

describe("設定の手順", () => {
  test("全20項目ある", () => {
    expect(CONFIG_STEPS.length).toBe(20);
  });

  test("4方向 → ボタン12個 → スティック4方向の順", () => {
    const 種類 = CONFIG_STEPS.map((s) => s.kind);
    expect(種類.slice(0, 4)).toEqual(["cursor", "cursor", "cursor", "cursor"]);
    expect(種類.slice(4, 16).every((k) => k === "button")).toBe(true);
    expect(種類.slice(16).every((k) => k === "stick")).toBe(true);
  });

  test("XInput の並びでボタンを尋ねる", () => {
    const ボタン = CONFIG_STEPS.filter((s) => s.kind === "button");
    expect(ボタン.map((s) => s.name)).toEqual([
      "A", "B", "X", "Y", "LB", "RB", "LT", "RT", "BACK", "START", "LS", "RS",
    ]);
    // 番号は GAMEPAD[].button[0〜11] に対応する
    expect(ボタン.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test("どの手順にも、絵の中の目印がある", () => {
    for (const step of CONFIG_STEPS) {
      expect(typeof step.marker).toBe("string");
      expect(step.marker.startsWith("pad-")).toBe(true);
    }
  });

  test("翻訳キーを持つ", () => {
    for (const step of CONFIG_STEPS) {
      expect(step.labelKey.startsWith("padconf.")).toBe(true);
    }
  });
});

describe("押されたものの見分け", () => {
  test("ボタンを押したら、その番号が返る", () => {
    const r = detectInput(pad(), pad([0, 0, 0, 0], [3]));
    expect(r).toEqual({ kind: "button", index: 3 });
  });

  test("軸を倒したら、その番号と向きが返る", () => {
    expect(detectInput(pad(), pad([0, -1, 0, 0]))).toEqual({ kind: "axis", index: 1, sign: -1 });
    expect(detectInput(pad(), pad([0.9, 0, 0, 0]))).toEqual({ kind: "axis", index: 0, sign: 1 });
  });

  test("静止位置が0でない軸でも、動いたぶんで見分ける", () => {
    // 軸1が静止時 -1 の機種。そこから +1 側へ動いた
    const 静止 = pad([0, -1, 0, 0]);
    expect(detectInput(静止, pad([0, 1, 0, 0]))).toEqual({ kind: "axis", index: 1, sign: 1 });
  });

  test("何も動いていなければ null", () => {
    expect(detectInput(pad(), pad())).toBeNull();
  });

  test("わずかな揺れは拾わない", () => {
    expect(detectInput(pad(), pad([0.05, -0.04, 0, 0]))).toBeNull();
  });

  test("ボタンが押されていれば、軸より優先する", () => {
    // スティックに触れたまま押した場合でも、押した意図を採る
    expect(detectInput(pad(), pad([0, -1, 0, 0], [5]))).toEqual({ kind: "button", index: 5 });
  });

  test("最も大きく動いた軸を採る", () => {
    expect(detectInput(pad(), pad([0.5, -1, 0, 0]))).toEqual({ kind: "axis", index: 1, sign: -1 });
  });
});

describe("ハットスイッチの見分け", () => {
  test("静止位置が範囲外の軸は、ハットとみなす", () => {
    // 4方向が1本の軸に載っている形式
    expect(isHatBinding({ kind: "axis", index: 9 }, [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.286])).toBe(true);
    expect(isHatBinding({ kind: "axis", index: 9 }, [0, 0, 0, 0, 0, 0, 0, 0, 0, -1.286])).toBe(true);
  });

  test("普通の軸はハットではない", () => {
    expect(isHatBinding({ kind: "axis", index: 1 }, [0, 0, 0, 0])).toBe(false);
  });

  test("ボタンはハットではない", () => {
    expect(isHatBinding({ kind: "button", index: 3 }, [0, 0, 0, 0])).toBe(false);
  });
});

describe("設定の組み立て", () => {
  test("最初は空", () => {
    const c = createConfig("PXN-P20", "1234:5678");
    expect(c.name).toBe("PXN-P20");
    expect(c.key).toBe("1234:5678");
    expect(c.cursor.filter(Boolean).length).toBe(0);
    expect(c.buttons.filter(Boolean).length).toBe(0);
  });

  test("手順の結果を記録できる", () => {
    const c = createConfig("x", "k");
    recordStep(c, CONFIG_STEPS[0], { kind: "button", index: 12 });
    expect(c.cursor[0]).toEqual({ kind: "button", index: 12 });
  });

  test("4方向でハットを選ぶと、残り3方向も自動で埋まる", () => {
    const c = createConfig("x", "k");
    // 上を押したらハット軸だった → 4方向すべてこの軸で決まる
    const 埋まった = recordStep(c, CONFIG_STEPS[0], { kind: "hat", index: 9 });
    expect(埋まった).toBe(3);
    expect(c.hatAxis).toBe(9);
    for (let i = 0; i < 4; i += 1) expect(c.cursor[i]).toEqual({ kind: "hat", index: 9 });
  });

  test("スティックは軸と向きを覚える", () => {
    const c = createConfig("x", "k");
    const 右 = CONFIG_STEPS.find((s) => s.kind === "stick" && s.stick === 0 && s.axis === 0);
    recordStep(c, 右, { kind: "axis", index: 3, sign: -1 });
    // 「右へ倒した時に -1 になる軸」なので、向きを反転して覚える
    expect(c.sticks[0][0]).toEqual({ index: 3, sign: -1 });
  });
});

describe("設定から配置を作る", () => {
  test("ハットと軸が反映される", () => {
    const c = createConfig("x", "k");
    c.hatAxis = 9;
    c.sticks = [[{ index: 0, sign: 1 }, { index: 3, sign: 1 }], [{ index: 4, sign: 1 }, { index: 6, sign: 1 }]];
    const l = buildLayoutFromConfig(c);
    expect(l.source).toBe("config");
    expect(l.hatAxis).toBe(9);
    expect(l.left).toEqual([0, 3]);
    expect(l.right).toEqual([4, 6]);
  });

  test("ボタンの割り当てが反映される", () => {
    const c = createConfig("x", "k");
    c.buttons[0] = { kind: "button", index: 2 };
    c.buttons[1] = { kind: "button", index: 0 };
    const l = buildLayoutFromConfig(c);
    expect(l.buttons[0]).toBe(2);
    expect(l.buttons[1]).toBe(0);
  });

  test("方向がボタンの機種にも対応する", () => {
    const c = createConfig("x", "k");
    c.cursor = [
      { kind: "button", index: 12 }, { kind: "button", index: 15 },
      { kind: "button", index: 13 }, { kind: "button", index: 14 },
    ];
    const l = buildLayoutFromConfig(c);
    expect(l.hatAxis).toBeNull();
    expect(l.dpadButtons).toEqual([12, 15, 13, 14]);
  });
});

describe("保存と読み出し", () => {
  test("保存する場所はゲームのURLごとに分かれる", () => {
    expect(storageKey("https://example.com/game-a/")).not.toBe(storageKey("https://example.com/game-b/"));
    expect(storageKey("https://example.com/game-a/").startsWith("arcadeer.gamepad")).toBe(true);
  });

  test("保存して読み出せる", () => {
    const c = createConfig("PXN-P20", "11ff:9608");
    c.hatAxis = 9;
    saveGamepadConfig(c, "https://example.com/g/");
    const r = loadGamepadConfig("11ff:9608", "https://example.com/g/");
    expect(r.name).toBe("PXN-P20");
    expect(r.hatAxis).toBe(9);
  });

  test("機種ごとに分けて持てる", () => {
    saveGamepadConfig(createConfig("A", "1:1"), "https://example.com/g/");
    saveGamepadConfig(createConfig("B", "2:2"), "https://example.com/g/");
    expect(loadGamepadConfig("1:1", "https://example.com/g/").name).toBe("A");
    expect(loadGamepadConfig("2:2", "https://example.com/g/").name).toBe("B");
  });

  test("別のゲームの設定は混ざらない", () => {
    saveGamepadConfig(createConfig("A", "1:1"), "https://example.com/g1/");
    expect(loadGamepadConfig("1:1", "https://example.com/g2/")).toBeNull();
  });

  test("無ければ null", () => {
    expect(loadGamepadConfig("9:9", "https://example.com/g/")).toBeNull();
  });

  test("消せる", () => {
    saveGamepadConfig(createConfig("A", "1:1"), "https://example.com/g/");
    expect(loadGamepadConfig("1:1", "https://example.com/g/")).not.toBeNull();
    clearGamepadConfig("1:1", "https://example.com/g/");
    expect(loadGamepadConfig("1:1", "https://example.com/g/")).toBeNull();
  });

  test("保存できない環境でも落ちない", () => {
    // プライベートモード等では保存に失敗する
    globalThis.localStorage = {
      getItem: () => { throw new Error("使えません"); },
      setItem: () => { throw new Error("使えません"); },
    };
    expect(saveGamepadConfig(createConfig("A", "1:1"), "https://example.com/g/")).toBe(false);
    expect(loadGamepadConfig("1:1", "https://example.com/g/")).toBeNull();
  });
});

describe("ハットスイッチの小さな変化も拾う", () => {
  /** PXN-P20: 中立 -1.286、上を押すと -1（差はわずか0.29） */
  const 静止 = { axes: [0, -1, 0, 0, 0, 0, 0, 0, 0, -1.286], buttons: [] };
  const 押した = (v) => ({ axes: [0, -1, 0, 0, 0, 0, 0, 0, 0, v], buttons: [] });

  test("中立が範囲外の軸は、わずかな変化でも押されたとみなす", () => {
    // 通常の基準（0.5）だと届かないため、専用の低い基準で見る
    expect(detectInput(静止, 押した(-1))).toEqual({ kind: "axis", index: 9, sign: 1 });
  });

  test("8方向すべてを拾える", () => {
    for (const v of [-1, -0.714, -0.429, -0.143, 0.143, 0.429, 0.714, 1]) {
      expect(detectInput(静止, 押した(v))).not.toBeNull();
    }
  });

  test("中立のままなら拾わない", () => {
    expect(detectInput(静止, 押した(-1.286))).toBeNull();
  });

  test("普通の軸は、これまでどおりの基準で見る", () => {
    // 触っていない程度の揺れは拾わない
    const a = { axes: [0, 0, 0, 0], buttons: [] };
    expect(detectInput(a, { axes: [0.3, 0, 0, 0], buttons: [] })).toBeNull();
    expect(detectInput(a, { axes: [0.8, 0, 0, 0], buttons: [] })).not.toBeNull();
  });
});

describe("割り当てない（この項目を飛ばす）", () => {
  test("方向を飛ばすと、未割り当てとして残る", () => {
    const c = createConfig("Test", "1234:5678");
    recordStep(c, CONFIG_STEPS[0], UNASSIGNED);
    expect(c.cursor[0]).toEqual(UNASSIGNED);
  });

  test("ボタンを飛ばすと、未割り当てとして残る", () => {
    const c = createConfig("Test", "1234:5678");
    const step = CONFIG_STEPS.find((s) => s.kind === "button" && s.name === "LT");
    recordStep(c, step, UNASSIGNED);
    expect(c.buttons[step.index]).toEqual(UNASSIGNED);
  });

  test("スティックを飛ばすと、未割り当てとして残る", () => {
    const c = createConfig("Test", "1234:5678");
    const step = CONFIG_STEPS.find((s) => s.kind === "stick" && s.name === "LS-down");
    recordStep(c, step, UNASSIGNED);
    expect(c.sticks[step.stick][step.axis]).toEqual(UNASSIGNED);
  });

  test("配置には「使わない」として伝わる", () => {
    const c = createConfig("Test", "1234:5678");
    recordStep(c, CONFIG_STEPS[0], UNASSIGNED);
    recordStep(c, CONFIG_STEPS.find((s) => s.name === "LT"), UNASSIGNED);
    recordStep(c, CONFIG_STEPS.find((s) => s.name === "LS-down"), UNASSIGNED);
    const layout = buildLayoutFromConfig(c);
    expect(layout.cursorNone).toEqual([true, false, false, false]);
    expect(layout.buttonNone[6]).toBe(true);
    expect(layout.buttonNone[0]).toBe(false);
    expect(layout.stickNone).toEqual([[false, true], [false, false]]);
  });

  test("飛ばしていない項目は、これまでどおり自動判定に任せる", () => {
    const layout = buildLayoutFromConfig(createConfig("Test", "1234:5678"));
    expect(layout.cursorNone).toEqual([false, false, false, false]);
    expect(layout.buttonNone.every((v) => v === false)).toBe(true);
    expect(layout.stickNone).toEqual([[false, false], [false, false]]);
  });
});

describe("ゲームが使う操作だけを尋ねる", () => {
  test("宣言が無ければ全20項目", () => {
    expect(stepsFor(null).length).toBe(20);
    expect(stepsFor(undefined)).toEqual(CONFIG_STEPS);
  });

  test("書いた種類だけを尋ねる", () => {
    const steps = stepsFor({ cursor: true, button: [0, 1], stick: ["left"] });
    expect(steps.map((s) => s.name)).toEqual([
      "up", "right", "down", "left",
      "A", "B",
      "LS-right", "LS-down",
    ]);
  });

  test("書かなかった種類は尋ねない", () => {
    expect(stepsFor({ button: [0] }).map((s) => s.name)).toEqual(["A"]);
    expect(stepsFor({ cursor: true }).map((s) => s.name)).toEqual(["up", "right", "down", "left"]);
    expect(stepsFor({ stick: ["right"] }).map((s) => s.name)).toEqual(["RS-right", "RS-down"]);
  });

  test("並べた順ではなく、元の順番で尋ねる", () => {
    const steps = stepsFor({ button: [3, 0] });
    expect(steps.map((s) => s.name)).toEqual(["A", "Y"]);
  });

  test("扱えない値は無視する", () => {
    expect(stepsFor({ button: [99, -1, "A"], stick: ["まんなか"], cursor: "はい" })).toEqual([]);
  });

  test("何も使わない宣言もできる", () => {
    expect(stepsFor({ cursor: false, button: [], stick: [] })).toEqual([]);
  });
});

describe("尋ねなかった項目の設定は残す", () => {
  test("保存済みの設定から始め、尋ねる項目だけを空にする", () => {
    const 保存済み = createConfig("Test", "1234:5678");
    保存済み.buttons[0] = { kind: "button", index: 2 };
    保存済み.buttons[1] = { kind: "button", index: 3 };
    保存済み.sticks[1] = [{ index: 4, sign: 1 }, { index: 5, sign: 1 }];

    const steps = stepsFor({ button: [0] });
    const c = startConfig("Test", "1234:5678", 保存済み, steps);
    // 尋ねる項目は空に戻す
    expect(c.buttons[0]).toBeNull();
    // 尋ねない項目はそのまま残る
    expect(c.buttons[1]).toEqual({ kind: "button", index: 3 });
    expect(c.sticks[1]).toEqual([{ index: 4, sign: 1 }, { index: 5, sign: 1 }]);
  });

  test("保存が無ければ、空の設定から始める", () => {
    const c = startConfig("Test", "1234:5678", null, CONFIG_STEPS);
    expect(c).toEqual(createConfig("Test", "1234:5678"));
  });

  test("保存済みを書き換えない（写しを使う）", () => {
    const 保存済み = createConfig("Test", "1234:5678");
    保存済み.buttons[0] = { kind: "button", index: 2 };
    startConfig("Test", "1234:5678", 保存済み, stepsFor({ button: [0] }));
    expect(保存済み.buttons[0]).toEqual({ kind: "button", index: 2 });
  });

  test("4方向を尋ねる時は、ハットの記憶も消す", () => {
    const 保存済み = createConfig("Test", "1234:5678");
    保存済み.hatAxis = 9;
    保存済み.cursor = [1, 2, 3, 4].map((i) => ({ kind: "hat", index: 9 }));
    const c = startConfig("Test", "1234:5678", 保存済み, stepsFor({ cursor: true }));
    expect(c.hatAxis).toBeNull();
    expect(c.cursor).toEqual([null, null, null, null]);
  });

  test("4方向を尋ねなければ、ハットの記憶は残す", () => {
    const 保存済み = createConfig("Test", "1234:5678");
    保存済み.hatAxis = 9;
    const c = startConfig("Test", "1234:5678", 保存済み, stepsFor({ button: [0] }));
    expect(c.hatAxis).toBe(9);
  });
});

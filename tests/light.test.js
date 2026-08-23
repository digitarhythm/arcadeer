// ライトの管理と計算のテスト
import { beforeEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_LIGHT_NAME,
  MAX_LIGHTS,
  LIGHT_TYPES,
  defaultLightParams,
  addLight,
  setLight,
  getLight,
  removeLight,
  clearLights,
  lights,
  shadowLight,
  setAmbient,
  ambient,
  lightDirection,
  lightVector,
} from "../web/light.js";

const near = (a, b, tol = 1e-5) => expect(Math.abs(a - b)).toBeLessThan(tol);

beforeEach(() => clearLights());

describe("既定のライト", () => {
  test("何も置かなくても1つある", () => {
    expect(lights().length).toBe(1);
    expect(lights()[0].name).toBe(DEFAULT_LIGHT_NAME);
  });

  test("既定は上手前から差す平行光", () => {
    const l = getLight(DEFAULT_LIGHT_NAME);
    expect(l.type).toBe("directional");
    // 斜め上から見下ろす既定カメラに合わせ、上・手前寄りから差す
    expect(l.Y).toBeGreaterThan(0);
    expect(l.intensity).toBeGreaterThan(0);
  });

  test("既定のライトが影を作る", () => {
    expect(getLight(DEFAULT_LIGHT_NAME).shadow).toBe(true);
    expect(shadowLight()?.name).toBe(DEFAULT_LIGHT_NAME);
  });

  test("使える種類は3つ", () => {
    expect(LIGHT_TYPES).toEqual(["directional", "point", "ambient"]);
  });
});

describe("ライトの追加", () => {
  test("名前を付けて追加できる", () => {
    addLight({ name: "torch", type: "point", X: 1, Y: 2, Z: 3 });
    const l = getLight("torch");
    expect([l.X, l.Y, l.Z]).toEqual([1, 2, 3]);
    expect(l.type).toBe("point");
  });

  test("同じ名前なら置き換える", () => {
    addLight({ name: "torch", X: 1 });
    addLight({ name: "torch", X: 9 });
    expect(lights().filter((l) => l.name === "torch").length).toBe(1);
    expect(getLight("torch").X).toBe(9);
  });

  test("名前が無ければ例外にする", () => {
    expect(() => addLight({})).toThrow();
    expect(() => addLight({ name: "" })).toThrow();
  });

  test("書かなかった項目は既定値になる", () => {
    addLight({ name: "torch" });
    expect(getLight("torch").intensity).toBe(defaultLightParams().intensity);
  });

  test("知らない種類は平行光として扱う", () => {
    addLight({ name: "odd", type: "laser" });
    expect(getLight("odd").type).toBe("directional");
  });

  test("上限を超えたら例外にする", () => {
    for (let i = lights().length; i < MAX_LIGHTS; i += 1) addLight({ name: `l${i}` });
    expect(lights().length).toBe(MAX_LIGHTS);
    expect(() => addLight({ name: "over" })).toThrow();
  });

  test("上限に達していても、置き換えならできる", () => {
    for (let i = lights().length; i < MAX_LIGHTS; i += 1) addLight({ name: `l${i}` });
    expect(() => addLight({ name: "l1", intensity: 0.5 })).not.toThrow();
  });
});

describe("ライトの変更", () => {
  test("書いた項目だけ変わる", () => {
    addLight({ name: "torch", X: 1, Y: 2, intensity: 1 });
    setLight({ name: "torch", intensity: 0.25 });
    const l = getLight("torch");
    expect(l.intensity).toBe(0.25);
    expect([l.X, l.Y]).toEqual([1, 2]);
  });

  test("名前を省略すると既定のライトが対象になる", () => {
    setLight({ intensity: 0.5 });
    expect(getLight(DEFAULT_LIGHT_NAME).intensity).toBe(0.5);
  });

  test("名前は付け替えられない", () => {
    addLight({ name: "torch" });
    setLight({ name: "torch", newName: "other" });
    expect(getLight("torch")).not.toBeNull();
  });

  test("無いライトを指定したら例外にする", () => {
    expect(() => setLight({ name: "missing", intensity: 1 })).toThrow();
  });

  test("影を作るライトを差し替えられる", () => {
    addLight({ name: "torch", shadow: true });
    setLight({ name: DEFAULT_LIGHT_NAME, shadow: false });
    expect(shadowLight()?.name).toBe("torch");
  });

  test("影を作るライトが無ければ null", () => {
    setLight({ name: DEFAULT_LIGHT_NAME, shadow: false });
    expect(shadowLight()).toBeNull();
  });
});

describe("ライトの削除", () => {
  test("削除できる", () => {
    addLight({ name: "torch" });
    expect(removeLight("torch")).toBe(true);
    expect(getLight("torch")).toBeNull();
  });

  test("無い名前を消しても落ちない", () => {
    expect(removeLight("missing")).toBe(false);
  });

  test("既定のライトを消すと作り直される", () => {
    removeLight(DEFAULT_LIGHT_NAME);
    expect(getLight(DEFAULT_LIGHT_NAME)).not.toBeNull();
  });
});

describe("環境光", () => {
  test("既定はうっすら明るい", () => {
    const a = ambient();
    expect(a.length).toBe(4);
    expect(a[0]).toBeGreaterThan(0);
    expect(a[0]).toBeLessThan(1);
  });

  test("色で指定できる", () => {
    setAmbient("#404040");
    near(ambient()[0], 0x40 / 255);
  });

  test("読めない値は既定へ戻す", () => {
    const base = ambient();
    setAmbient("あか");
    expect(ambient()).toEqual(base);
  });
});

describe("向きの計算", () => {
  test("平行光の向きは位置から注視点へ", () => {
    addLight({ name: "sun", type: "directional", X: 0, Y: 10, Z: 0, targetX: 0, targetY: 0, targetZ: 0 });
    const d = lightDirection(getLight("sun"));
    // 真上から真下へ向かう
    near(d[0], 0);
    near(d[1], -1);
    near(d[2], 0);
  });

  test("向きの長さは1にそろえる", () => {
    addLight({ name: "sun", X: 3, Y: 4, Z: 5, targetX: 0, targetY: 0, targetZ: 0 });
    near(Math.hypot(...lightDirection(getLight("sun"))), 1);
  });

  test("位置と注視点が同じでも落ちない", () => {
    addLight({ name: "sun", X: 0, Y: 0, Z: 0, targetX: 0, targetY: 0, targetZ: 0 });
    const d = lightDirection(getLight("sun"));
    for (const v of d) expect(Number.isFinite(v)).toBe(true);
  });

  test("シェーダーへ渡す値は、平行光なら向き・点光源なら位置", () => {
    addLight({ name: "sun", type: "directional", X: 0, Y: 10, Z: 0 });
    addLight({ name: "torch", type: "point", X: 1, Y: 2, Z: 3 });
    // 平行光は「光が進む向き」
    near(lightVector(getLight("sun"))[1], -1);
    // 点光源は位置そのもの
    expect(lightVector(getLight("torch"))).toEqual([1, 2, 3]);
  });
});

// glTF(GLB) 解析のテスト
// 同梱のデフォルト猫モデルを実データとして使う
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseGlb,
  readAccessor,
  collectPrimitives,
  computeBounds,
  computeBox,
  collectClips,
} from "../web/glb.js";

const GLB_PATH = join(import.meta.dir, "..", "web", "templates", "assets", "default-cat.glb");

function loadGlb() {
  const buf = readFileSync(GLB_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("GLBの解析", () => {
  test("JSONチャンクとBINチャンクを取り出せる", () => {
    const { json, bin } = parseGlb(loadGlb());
    expect(json.asset.version).toBe("2.0");
    expect(json.meshes.length).toBe(1);
    expect(bin.byteLength).toBeGreaterThan(0);
  });

  test("GLBでないデータは拒否する", () => {
    const notGlb = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer;
    expect(() => parseGlb(notGlb)).toThrow();
  });
});

describe("アクセサの読み出し", () => {
  test("頂点座標を Float32Array として読める", () => {
    const { json, bin } = parseGlb(loadGlb());
    const index = json.meshes[0].primitives[0].attributes.POSITION;
    const values = readAccessor(json, bin, index);
    expect(values).toBeInstanceOf(Float32Array);
    // VEC3 なので 要素数 = count * 3
    expect(values.length).toBe(json.accessors[index].count * 3);
  });

  test("インデックスを整数配列として読める", () => {
    const { json, bin } = parseGlb(loadGlb());
    const index = json.meshes[0].primitives[0].indices;
    const values = readAccessor(json, bin, index);
    expect(values.length).toBe(json.accessors[index].count);
    // 三角形なので3の倍数
    expect(values.length % 3).toBe(0);
  });
});

describe("描画対象の収集", () => {
  test("シーンからプリミティブを集められる", () => {
    const { json, bin } = parseGlb(loadGlb());
    const primitives = collectPrimitives(json, bin);
    expect(primitives.length).toBe(1);

    const p = primitives[0];
    expect(p.positions).toBeInstanceOf(Float32Array);
    expect(p.normals).toBeInstanceOf(Float32Array);
    expect(p.colors).toBeInstanceOf(Float32Array);
    expect(p.indices.length % 3).toBe(0);
    // ワールド変換行列は 4x4
    expect(p.matrix.length).toBe(16);
  });

  test("頂点カラーは RGBA の4要素で返る", () => {
    const { json, bin } = parseGlb(loadGlb());
    const p = collectPrimitives(json, bin)[0];
    expect(p.colors.length).toBe((p.positions.length / 3) * 4);
  });
});

describe("バウンディングの計算", () => {
  test("中心と半径が求まる", () => {
    const { json, bin } = parseGlb(loadGlb());
    const bounds = computeBounds(collectPrimitives(json, bin));
    expect(bounds.radius).toBeGreaterThan(0);
    expect(bounds.center.length).toBe(3);
    for (const v of bounds.center) expect(Number.isFinite(v)).toBe(true);
  });

  test("対象が無ければ半径0になる", () => {
    const bounds = computeBounds([]);
    expect(bounds.radius).toBe(0);
  });

  test("外接直方体が求まる（当たり判定に使う）", () => {
    const { json, bin } = parseGlb(loadGlb());
    const box = computeBox(collectPrimitives(json, bin));
    expect(box.center.length).toBe(3);
    expect(box.half.length).toBe(3);
    for (const v of box.half) expect(v).toBeGreaterThan(0);
  });

  test("外接直方体は、外接球より小さいか同じ", () => {
    // 球は角までの距離、直方体は各軸の半分なので、各辺は半径を超えない
    const { json, bin } = parseGlb(loadGlb());
    const 頂点 = collectPrimitives(json, bin);
    const 球 = computeBounds(頂点);
    const 箱 = computeBox(頂点);
    for (const v of 箱.half) expect(v).toBeLessThanOrEqual(球.radius + 1e-6);
  });

  test("対象が無ければ大きさ0になる", () => {
    expect(computeBox([])).toEqual({ center: [0, 0, 0], half: [0, 0, 0] });
  });
});

describe("アニメーションクリップの取り出し", () => {
  test("同梱の猫モデルは3つのクリップを持つ", () => {
    const { json, bin } = parseGlb(loadGlb());
    const clips = collectClips(json, bin);
    expect(clips.map((c) => c.name).sort()).toEqual(["Jump", "Run", "Walk"]);
  });

  test("クリップの長さが取れる", () => {
    const { json, bin } = parseGlb(loadGlb());
    const byName = Object.fromEntries(collectClips(json, bin).map((c) => [c.name, c]));
    expect(byName.Walk.duration).toBeCloseTo(1.0, 2);
    expect(byName.Run.duration).toBeCloseTo(0.55, 2);
    expect(byName.Jump.duration).toBeCloseTo(1.3, 2);
  });

  test("各クリップは動かす対象の情報を持つ", () => {
    const { json, bin } = parseGlb(loadGlb());
    const walk = collectClips(json, bin).find((c) => c.name === "Walk");
    expect(walk.channels.length).toBeGreaterThan(0);
    for (const ch of walk.channels) {
      expect(typeof ch.node).toBe("number");
      expect(["translation", "rotation", "scale"]).toContain(ch.path);
      // 時刻と値の並びが対になっている
      expect(ch.times.length).toBeGreaterThan(0);
      expect(ch.values.length % ch.times.length).toBe(0);
    }
  });

  test("アニメーションが無いモデルでは空になる", () => {
    expect(collectClips({ asset: { version: "2.0" } }, new ArrayBuffer(0))).toEqual([]);
  });
});

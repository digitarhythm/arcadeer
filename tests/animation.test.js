// アニメーションの補間とスケルトン構築のテスト
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseGlb, collectClips, collectSkin, collectPrimitives } from "../web/glb.js";
import { sampleClip, jointMatrices, slerp, stripRootMotion } from "../web/animation.js";

const GLB_PATH = join(import.meta.dir, "..", "web", "templates", "assets", "default-cat.glb");
function loadGlb() {
  const buf = readFileSync(GLB_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** 誤差を許して比べる */
const near = (a, b, tol = 1e-5) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe("四元数の球面補間", () => {
  test("端では元の値になる", () => {
    const a = [0, 0, 0, 1];
    const b = [0, 0.7071068, 0, 0.7071068];
    expect(slerp(a, b, 0)).toEqual(a);
    for (let i = 0; i < 4; i += 1) near(slerp(a, b, 1)[i], b[i]);
  });

  test("中間では長さ1が保たれる", () => {
    const q = slerp([0, 0, 0, 1], [0, 0.7071068, 0, 0.7071068], 0.5);
    near(Math.hypot(...q), 1);
  });

  test("近い方の弧を通る（符号が逆でも遠回りしない）", () => {
    // b は a と同じ回転を表すが符号が逆。補間結果は a に近いままになる
    const a = [0, 0, 0, 1];
    const b = [0, 0, 0, -1];
    const q = slerp(a, b, 0.5);
    near(Math.abs(q[3]), 1);
  });
});

describe("クリップのサンプリング", () => {
  const clip = {
    name: "test",
    duration: 2,
    channels: [
      {
        node: 3,
        path: "translation",
        times: new Float32Array([0, 1, 2]),
        values: new Float32Array([0, 0, 0, 10, 0, 0, 20, 0, 0]),
        interpolation: "LINEAR",
      },
    ],
  };

  test("キーフレームちょうどの時刻ではその値になる", () => {
    near(sampleClip(clip, 1).get(3).translation[0], 10);
  });

  test("キーフレームの間は線形に補間する", () => {
    near(sampleClip(clip, 0.5).get(3).translation[0], 5);
    near(sampleClip(clip, 1.25).get(3).translation[0], 12.5);
  });

  test("最初より前は最初の値、最後より後は最後の値にする", () => {
    near(sampleClip(clip, -5).get(3).translation[0], 0);
    near(sampleClip(clip, 99).get(3).translation[0], 20);
  });

  test("STEP補間では手前のキーの値を保つ", () => {
    const step = { ...clip, channels: [{ ...clip.channels[0], interpolation: "STEP" }] };
    near(sampleClip(step, 0.9).get(3).translation[0], 0);
    near(sampleClip(step, 1.1).get(3).translation[0], 10);
  });

  test("回転は球面補間で長さ1を保つ", () => {
    const rot = {
      name: "rot",
      duration: 1,
      channels: [
        {
          node: 1,
          path: "rotation",
          times: new Float32Array([0, 1]),
          values: new Float32Array([0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068]),
          interpolation: "LINEAR",
        },
      ],
    };
    near(Math.hypot(...sampleClip(rot, 0.5).get(1).rotation), 1);
  });

  test("チャンネルが無ければ空になる", () => {
    expect(sampleClip({ name: "x", duration: 0, channels: [] }, 0).size).toBe(0);
  });
});

describe("スケルトン（同梱の猫モデル）", () => {
  test("スキン情報を取り出せる", () => {
    const { json, bin } = parseGlb(loadGlb());
    const skin = collectSkin(json, bin, 0);
    expect(skin.joints.length).toBe(12);
    // 逆バインド行列は 4x4 × ボーン数
    expect(skin.inverseBind.length).toBe(12 * 16);
  });

  test("プリミティブがボーンの割り当てを持つ", () => {
    const { json, bin } = parseGlb(loadGlb());
    const p = collectPrimitives(json, bin)[0];
    const vertices = p.positions.length / 3;
    expect(p.joints.length).toBe(vertices * 4);
    expect(p.weights.length).toBe(vertices * 4);
  });

  test("ボーン行列がボーン数ぶん求まる", () => {
    const { json, bin } = parseGlb(loadGlb());
    const skin = collectSkin(json, bin, 0);
    const clip = collectClips(json, bin).find((c) => c.name === "Walk");

    const matrices = jointMatrices(json, skin, sampleClip(clip, 0.5));
    expect(matrices.length).toBe(12 * 16);
    for (const v of matrices) expect(Number.isFinite(v)).toBe(true);
  });

  test("時刻が違えばボーン行列も変わる", () => {
    const { json, bin } = parseGlb(loadGlb());
    const skin = collectSkin(json, bin, 0);
    const clip = collectClips(json, bin).find((c) => c.name === "Walk");

    const a = jointMatrices(json, skin, sampleClip(clip, 0.0));
    const b = jointMatrices(json, skin, sampleClip(clip, 0.5));
    expect([...a]).not.toEqual([...b]);
  });

  test("姿勢を与えなければバインドポーズになる", () => {
    // 逆バインド行列と打ち消し合い、ほぼ単位行列になる
    const { json, bin } = parseGlb(loadGlb());
    const skin = collectSkin(json, bin, 0);
    const matrices = jointMatrices(json, skin, new Map());
    for (let j = 0; j < skin.joints.length; j += 1) {
      const m = matrices.slice(j * 16, j * 16 + 16);
      near(m[0], 1, 1e-4);
      near(m[5], 1, 1e-4);
      near(m[10], 1, 1e-4);
      near(m[12], 0, 1e-4);
    }
  });
});

describe("スケルトンの根ボーン", () => {
  test("skin.skeleton があればそれを根とする", () => {
    const { json, bin } = parseGlb(loadGlb());
    const skin = collectSkin(json, bin, 0);
    // 同梱の猫モデルは skeleton = 1（hips）
    expect(skin.root).toBe(1);
  });

  test("skin.skeleton が無ければ親を持たないボーンを根とする", () => {
    const gltf = {
      skins: [{ joints: [5, 6, 7] }],
      nodes: [],
    };
    // 6 と 7 は 5 の子。よって根は 5
    gltf.nodes[5] = { children: [6, 7] };
    gltf.nodes[6] = {};
    gltf.nodes[7] = {};
    expect(collectSkin(gltf, null, 0).root).toBe(5);
  });
});

describe("ルートモーションの無効化（stripRootMotion）", () => {
  const pose = () =>
    new Map([
      [1, { translation: [0, 0.48, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }],
      [2, { translation: [0, 0.1, 0], rotation: [0, 0, 0, 1] }],
    ]);

  test("根ボーンの移動だけを取り除く", () => {
    const out = stripRootMotion(pose(), 1);
    expect(out.get(1).translation).toBeUndefined();
  });

  test("根ボーンの回転と拡大縮小は残す", () => {
    const out = stripRootMotion(pose(), 1);
    expect(out.get(1).rotation).toEqual([0, 0, 0, 1]);
    expect(out.get(1).scale).toEqual([1, 1, 1]);
  });

  test("根以外のボーンの移動は残す", () => {
    const out = stripRootMotion(pose(), 1);
    expect(out.get(2).translation).toEqual([0, 0.1, 0]);
  });

  test("元の姿勢は書き換えない", () => {
    const original = pose();
    stripRootMotion(original, 1);
    expect(original.get(1).translation).toEqual([0, 0.48, 0]);
  });

  test("根ボーンの指定が無ければそのまま返す", () => {
    const out = stripRootMotion(pose(), null);
    expect(out.get(1).translation).toEqual([0, 0.48, 0]);
  });

  test("Jump の上下移動が消え、バインドポーズの高さに固定される", () => {
    const { json, bin } = parseGlb(loadGlb());
    const skin = collectSkin(json, bin, 0);
    const clip = collectClips(json, bin).find((c) => c.name === "Jump");

    // 根ボーンのワールド位置のY成分を、無効化の有無で比べる
    const rootY = (stripped) => {
      const ys = [];
      for (let t = 0; t <= clip.duration; t += clip.duration / 20) {
        let p = sampleClip(clip, t);
        if (stripped) p = stripRootMotion(p, skin.root);
        // 逆バインド行列を掛ける前の値が要るので、単位行列のスキンで取り出す
        const m = jointMatrices(json, { joints: [skin.root], inverseBind: identity16() }, p);
        ys.push(m[13]);
      }
      return { min: Math.min(...ys), max: Math.max(...ys) };
    };

    const moving = rootY(false);
    const fixed = rootY(true);
    // そのまま再生すると上下する
    expect(moving.max - moving.min).toBeGreaterThan(0.3);
    // 無効化すると動かない
    expect(fixed.max - fixed.min).toBeLessThan(1e-6);
    // 固定される高さはバインドポーズ（hips の translation.y = 0.55）
    near(fixed.min, 0.55, 1e-4);
  });
});

/** 単位行列ひとつぶん */
function identity16() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

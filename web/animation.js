// アニメーションの補間とスケルトンの計算
//
// 「クリップと時刻」から各ボーンの姿勢を求め、描画に渡すボーン行列を作る。
// WebGLに依存しないため単体テストできる。

import { fromTRS, multiply } from "./matrix.js";

/**
 * 四元数の球面補間
 *
 * 符号が逆の四元数は同じ回転を表すため、**近い方の弧**を通るようにそろえる。
 */
export function slerp(a, b, t) {
  if (t <= 0) return a;

  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    // 遠回りしないよう符号を反転する
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }
  if (t >= 1) return [bx, by, bz, bw];

  // ほぼ同じ向きなら線形補間で十分（0除算も避けられる）
  if (dot > 0.9995) {
    const q = [
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ];
    const len = Math.hypot(...q) || 1;
    return q.map((v) => v / len);
  }

  const theta = Math.acos(dot);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/** 時刻を挟むキーフレームの位置と、その間の割合を求める */
function findKey(times, time) {
  if (time <= times[0]) return { index: 0, next: 0, ratio: 0 };
  const last = times.length - 1;
  if (time >= times[last]) return { index: last, next: last, ratio: 0 };

  let index = 0;
  while (index < last && times[index + 1] < time) index += 1;
  const span = times[index + 1] - times[index];
  return {
    index,
    next: index + 1,
    ratio: span > 0 ? (time - times[index]) / span : 0,
  };
}

/** チャンネルから値を1つ取り出す */
function valueAt(channel, index, size) {
  const out = new Array(size);
  for (let i = 0; i < size; i += 1) out[i] = channel.values[index * size + i];
  return out;
}

/**
 * クリップを指定時刻でサンプリングする
 *
 * @returns ノード番号 → `{ translation?, rotation?, scale? }`
 */
export function sampleClip(clip, time) {
  const pose = new Map();

  for (const channel of clip?.channels ?? []) {
    const size = channel.path === "rotation" ? 4 : 3;
    const { index, next, ratio } = findKey(channel.times, time);
    const from = valueAt(channel, index, size);

    let value;
    if (index === next || channel.interpolation === "STEP") {
      // STEP は手前のキーの値を保つ
      value = from;
    } else {
      const to = valueAt(channel, next, size);
      value =
        channel.path === "rotation"
          ? slerp(from, to, ratio)
          : from.map((v, i) => v + (to[i] - v) * ratio);
    }

    const entry = pose.get(channel.node) ?? {};
    entry[channel.path] = value;
    pose.set(channel.node, entry);
  }

  return pose;
}

/**
 * 姿勢から**根ボーンの移動だけ**を取り除く（ルートモーションの無効化）
 *
 * クリップが持つ上下・前後の移動を止め、その場で再生させる。位置はゲーム側が
 * `@X/@Y/@Z` で制御する前提。移動を外した根ボーンはバインドポーズの位置に戻る。
 * 回転と拡大縮小はそのまま残すので、跳躍中の姿勢変化などは失われない。
 *
 * 元の姿勢は書き換えず、新しい Map を返す。
 */
export function stripRootMotion(pose, rootNode) {
  if (typeof rootNode !== "number") return pose;
  const entry = pose?.get(rootNode);
  if (!entry?.translation) return pose;

  const out = new Map(pose);
  const { translation: _dropped, ...rest } = entry;
  out.set(rootNode, rest);
  return out;
}

/** ノードの姿勢（アニメーションの指定があればそれを優先）から行列を作る */
function localMatrix(node, posed) {
  const translation = posed?.translation ?? node?.translation ?? [0, 0, 0];
  const rotation = posed?.rotation ?? node?.rotation ?? [0, 0, 0, 1];
  const scale = posed?.scale ?? node?.scale ?? [1, 1, 1];
  // matrix を直接持つノードは、アニメーションの指定が無ければそれを使う
  if (node?.matrix && !posed) return new Float32Array(node.matrix);
  return fromTRS(translation, rotation, scale);
}

/** ノードのワールド行列を、親から順に求める */
function worldMatrices(gltf, pose) {
  const world = new Map();
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  const walk = (index, parent) => {
    const node = gltf.nodes?.[index];
    if (!node) return;
    const matrix = multiply(parent, localMatrix(node, pose.get(index)));
    world.set(index, matrix);
    for (const child of node.children ?? []) walk(child, matrix);
  };

  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? [];
  for (const root of roots) walk(root, identity);
  return world;
}

/**
 * 描画へ渡すボーン行列を作る
 *
 * 各ボーンについて「ワールド行列 × 逆バインド行列」を求め、まとめて並べる。
 * 姿勢を渡さなければバインドポーズ（＝ほぼ単位行列）になる。
 */
export function jointMatrices(gltf, skin, pose) {
  const world = worldMatrices(gltf, pose ?? new Map());
  const out = new Float32Array(skin.joints.length * 16);

  for (let j = 0; j < skin.joints.length; j += 1) {
    const jointWorld = world.get(skin.joints[j]);
    const inverseBind = skin.inverseBind.subarray(j * 16, j * 16 + 16);
    const matrix = jointWorld ? multiply(jointWorld, inverseBind) : inverseBind;
    out.set(matrix, j * 16);
  }
  return out;
}

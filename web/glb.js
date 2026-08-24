// glTF 2.0（GLB）の解析モジュール
// サムネイル生成に必要な最小限（ジオメトリと頂点カラー）だけを取り出す。
// DOM/WebGL には依存しないため、単体テストできる。

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** アクセサの componentType → TypedArray */
const COMPONENT_TYPES = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};

/** アクセサの type → 1要素あたりの成分数 */
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/**
 * GLBを JSONチャンクとBINチャンクに分解する
 * @returns {{json: object, bin: ArrayBuffer}}
 */
export function parseGlb(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (arrayBuffer.byteLength < 12 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("not a GLB file");
  }
  const total = view.getUint32(8, true);

  let json = null;
  let bin = new ArrayBuffer(0);
  let offset = 12;
  while (offset + 8 <= total && offset + 8 <= arrayBuffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, start, length)));
    } else if (type === CHUNK_BIN) {
      bin = arrayBuffer.slice(start, start + length);
    }
    offset = start + length;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

/**
 * アクセサの内容を TypedArray として読み出す
 * サムネイル用途のため、疎（sparse）アクセサには対応しない。
 */
export function readAccessor(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const ArrayType = COMPONENT_TYPES[accessor.componentType];
  const components = TYPE_COMPONENTS[accessor.type];
  if (!ArrayType || !components) throw new Error("unsupported accessor");

  const total = accessor.count * components;
  if (accessor.bufferView === undefined) return new ArrayType(total);

  const view = gltf.bufferViews[accessor.bufferView];
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? 0;
  const packed = ArrayType.BYTES_PER_ELEMENT * components;

  // 詰めて並んでいる場合はそのまま参照できる
  if (stride === 0 || stride === packed) {
    return new ArrayType(bin.slice(base, base + total * ArrayType.BYTES_PER_ELEMENT));
  }

  // 飛び飛びに並んでいる場合は詰め直す
  const out = new ArrayType(total);
  for (let i = 0; i < accessor.count; i += 1) {
    const chunk = new ArrayType(bin.slice(base + i * stride, base + i * stride + packed));
    out.set(chunk, i * components);
  }
  return out;
}

/** 4x4 単位行列 */
function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** 列優先の 4x4 行列を掛ける（a のあとに b を適用） */
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** ノードの TRS（または matrix）からローカル変換行列を作る */
function localMatrix(node) {
  if (node.matrix) return node.matrix.slice();

  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/**
 * シーンを辿って、描画に必要なプリミティブを集める
 *
 * スキニングは適用せず、バインドポーズのまま描く（サムネイル用途のため）。
 * 三角形以外の描画モードは対象外。
 */
export function collectPrimitives(gltf, bin) {
  const primitives = [];
  const sceneIndex = gltf.scene ?? 0;
  const roots = gltf.scenes?.[sceneIndex]?.nodes ?? [];

  const walk = (nodeIndex, parentMatrix) => {
    const node = gltf.nodes?.[nodeIndex];
    if (!node) return;
    const matrix = multiply(parentMatrix, localMatrix(node));

    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives ?? []) {
        // mode 未指定は三角形（4）
        if ((primitive.mode ?? 4) !== 4) continue;
        const positionIndex = primitive.attributes?.POSITION;
        if (positionIndex === undefined) continue;

        const positions = readAccessor(gltf, bin, positionIndex);
        const vertexCount = positions.length / 3;

        let normals = null;
        if (primitive.attributes.NORMAL !== undefined) {
          normals = readAccessor(gltf, bin, primitive.attributes.NORMAL);
        }

        let colors = null;
        if (primitive.attributes.COLOR_0 !== undefined) {
          colors = toRgba(gltf, bin, primitive.attributes.COLOR_0, vertexCount);
        }

        const indices =
          primitive.indices !== undefined
            ? readAccessor(gltf, bin, primitive.indices)
            : sequentialIndices(vertexCount);

        // スキニング用のボーン番号と重み（無い場合は先頭ボーンに固定）
        const joints =
          primitive.attributes.JOINTS_0 !== undefined
            ? Float32Array.from(readAccessor(gltf, bin, primitive.attributes.JOINTS_0))
            : new Float32Array(vertexCount * 4);
        const weights =
          primitive.attributes.WEIGHTS_0 !== undefined
            ? Float32Array.from(readAccessor(gltf, bin, primitive.attributes.WEIGHTS_0))
            : defaultWeights(vertexCount);

        primitives.push({
          positions,
          normals: normals ?? computeNormals(positions, indices),
          colors: colors ?? whiteColors(vertexCount),
          joints,
          weights,
          indices,
          matrix,
          // このメッシュが使うスキン（無ければ null）
          skin: node.skin ?? null,
        });
      }
    }

    for (const child of node.children ?? []) walk(child, matrix);
  };

  for (const root of roots) walk(root, identity());
  return primitives;
}

/** 頂点カラーを 0〜1 の RGBA float に揃える */
function toRgba(gltf, bin, accessorIndex, vertexCount) {
  const accessor = gltf.accessors[accessorIndex];
  const raw = readAccessor(gltf, bin, accessorIndex);
  const components = TYPE_COMPONENTS[accessor.type];
  // 整数型は正規化された値として扱う
  const scale =
    accessor.componentType === 5121 ? 1 / 255 : accessor.componentType === 5123 ? 1 / 65535 : 1;

  const out = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i += 1) {
    out[i * 4] = raw[i * components] * scale;
    out[i * 4 + 1] = raw[i * components + 1] * scale;
    out[i * 4 + 2] = raw[i * components + 2] * scale;
    out[i * 4 + 3] = components === 4 ? raw[i * components + 3] * scale : 1;
  }
  return out;
}

/** ボーンの重みが無いモデル用（先頭ボーンに全体重を置く） */
function defaultWeights(vertexCount) {
  const out = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i += 1) out[i * 4] = 1;
  return out;
}

/** 頂点カラーが無いモデル用の白 */
function whiteColors(vertexCount) {
  return new Float32Array(vertexCount * 4).fill(1);
}

/** インデックスが無い場合の連番 */
function sequentialIndices(vertexCount) {
  const out = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) out[i] = i;
  return out;
}

/** 法線が無いモデル用に、面法線を頂点へ均して求める */
function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const base of [a, b, c]) {
      normals[base] += nx;
      normals[base + 1] += ny;
      normals[base + 2] += nz;
    }
  }
  return normals;
}

/**
 * スキン（ボーンの一覧と逆バインド行列）を取り出す
 *
 * 逆バインド行列は「バインドポーズの姿勢を打ち消す」ための行列で、
 * ボーン行列と掛け合わせて頂点の変形量を求める。
 */
export function collectSkin(gltf, bin, skinIndex) {
  const skin = gltf.skins?.[skinIndex];
  if (!skin) return null;
  const joints = skin.joints ?? [];
  const inverseBind =
    skin.inverseBindMatrices !== undefined
      ? Float32Array.from(readAccessor(gltf, bin, skin.inverseBindMatrices))
      : identityMatrices(joints.length);
  return { joints, inverseBind, root: skeletonRoot(gltf, skin, joints) };
}

/**
 * スケルトンの根ボーンを求める
 *
 * `skin.skeleton` があればそれを使い、無ければ**他のボーンの子になっていない**
 * ボーンを根とみなす。ルートモーションの無効化で参照する。
 */
function skeletonRoot(gltf, skin, joints) {
  if (typeof skin.skeleton === "number") return skin.skeleton;
  const children = new Set();
  for (const joint of joints) {
    for (const child of gltf.nodes?.[joint]?.children ?? []) children.add(child);
  }
  return joints.find((joint) => !children.has(joint)) ?? null;
}

/** 逆バインド行列が無い場合の単位行列の並び */
function identityMatrices(count) {
  const out = new Float32Array(count * 16);
  for (let i = 0; i < count; i += 1) {
    out[i * 16] = 1;
    out[i * 16 + 5] = 1;
    out[i * 16 + 10] = 1;
    out[i * 16 + 15] = 1;
  }
  return out;
}

/**
 * アニメーションクリップを取り出す
 *
 * 各クリップは「どのノードの何を、どの時刻にどの値へ」動かすかの一覧を持つ。
 * 実際の補間は再生側が行う。
 */
export function collectClips(gltf, bin) {
  return (gltf.animations ?? []).map((animation, index) => {
    const channels = [];
    let duration = 0;

    for (const channel of animation.channels ?? []) {
      const sampler = animation.samplers?.[channel.sampler];
      const path = channel.target?.path;
      const node = channel.target?.node;
      if (!sampler || node === undefined) continue;
      if (!["translation", "rotation", "scale"].includes(path)) continue;

      const times = readAccessor(gltf, bin, sampler.input);
      const values = readAccessor(gltf, bin, sampler.output);
      if (times.length === 0) continue;

      duration = Math.max(duration, times[times.length - 1]);
      channels.push({
        node,
        path,
        times,
        values,
        // 補間方法（既定は線形）
        interpolation: sampler.interpolation ?? "LINEAR",
      });
    }

    return {
      name: animation.name ?? `clip${index}`,
      duration,
      channels,
    };
  });
}

/**
 * プリミティブ全体を包む軸沿いの直方体を求める
 *
 * 当たり判定で「見た目そのもの」を使う時のもとになる（5.5節）。
 * カメラ合わせに使う外接球（`computeBounds`）と違い、**各軸ごとの長さ**が要る。
 *
 * @returns `{ center, half }`。中身が無ければ大きさ0
 */
export function computeBox(primitives) {
  const { min, max } = 範囲(primitives);
  if (!Number.isFinite(min[0])) return { center: [0, 0, 0], half: [0, 0, 0] };
  return {
    center: [0, 1, 2].map((i) => (min[i] + max[i]) / 2),
    half: [0, 1, 2].map((i) => (max[i] - min[i]) / 2),
  };
}

/** 全頂点を配置行列に通して、各軸の最小と最大を求める */
function 範囲(primitives) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];

  for (const p of primitives) {
    const m = p.matrix;
    for (let i = 0; i + 2 < p.positions.length; i += 3) {
      const [x, y, z] = [p.positions[i], p.positions[i + 1], p.positions[i + 2]];
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      min = [Math.min(min[0], wx), Math.min(min[1], wy), Math.min(min[2], wz)];
      max = [Math.max(max[0], wx), Math.max(max[1], wy), Math.max(max[2], wz)];
    }
  }
  return { min, max };
}

/**
 * プリミティブ全体を包む中心と半径を求める
 * カメラを自動で合わせるために使う。
 */
export function computeBounds(primitives) {
  const { min, max } = 範囲(primitives);

  if (!Number.isFinite(min[0])) return { center: [0, 0, 0], radius: 0 };

  const center = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  // 各軸の半分の長さではなく、中心から角までの距離（バウンディング球の半径）を使う。
  // 最大辺だけで見るとモデルが画角からはみ出すため。
  const half = [0, 1, 2].map((i) => (max[i] - min[i]) / 2);
  const radius = Math.hypot(half[0], half[1], half[2]);
  return { center, radius };
}

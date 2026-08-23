// 4x4行列の計算（列優先。WebGLへそのまま渡せる並び）
//
// 描画（renderer.js）とサムネイル生成（model-preview.js）で共通に使う。
// DOM/WebGLに依存しないため、単体テストできる。

/** 単位行列 */
export function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/**
 * 行列を掛ける
 *
 * `multiply(a, b)` は「**a のあとに b を適用**」する合成になる
 * （点に対しては a * b * p の順で効く）。
 */
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** 平行移動 */
export function translation(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

/** 拡大縮小 */
export function scaling(x, y, z) {
  return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
}

/** X軸まわりの回転 */
export function rotationX(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

/** Z軸まわりの回転 */
export function rotationZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** Y軸まわりの回転 */
export function rotationY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

/**
 * 平行移動・回転（四元数）・拡大縮小から行列を作る
 *
 * glTFのノードが持つ TRS をそのまま渡せる形にしてある。
 */
export function fromTRS([tx, ty, tz], [qx, qy, qz, qw], [sx, sy, sz]) {
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

  return new Float32Array([
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

/** 透視投影 */
export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** 注視行列（視点・注視点・上方向から作る） */
export function lookAt(eye, target, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const norm = (v) => {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);

  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

/**
 * 正射影行列（遠近感を付けない投影）
 *
 * 平行光の影を描く時に使う。太陽のように平行に差す光は、
 * 遠近法ではなく**同じ大きさのまま**写すのが正しい。
 */
export function orthographic(left, right, bottom, top, near, far) {
  const width = right - left;
  const height = top - bottom;
  const depth = far - near;
  return new Float32Array([
    2 / width, 0, 0, 0,
    0, 2 / height, 0, 0,
    0, 0, -2 / depth, 0,
    -(right + left) / width, -(top + bottom) / height, -(far + near) / depth, 1,
  ]);
}

/**
 * ライトから見た「注視 × 投影」行列
 *
 * 影を描くために、光源の側から一度シーンを写す。
 *
 * @param light 位置（X/Y/Z）と注視点（targetX/Y/Z）を持つライト
 * @param radius 影を落とす範囲の半径（注視点を中心とした正方形の半幅）
 */
export function lightViewProjection(light, radius, near, far) {
  const eye = [light?.X ?? 0, light?.Y ?? 0, light?.Z ?? 0];
  const target = [light?.targetX ?? 0, light?.targetY ?? 0, light?.targetZ ?? 0];

  // 視線が真上・真下のとき、上方向(0,1,0)と重なって向きが決まらなくなる
  const dx = target[0] - eye[0];
  const dz = target[2] - eye[2];
  const up = Math.hypot(dx, dz) < 1e-6 ? [0, 0, 1] : [0, 1, 0];

  const view = lookAt(eye, target, up);
  const projection = orthographic(-radius, radius, -radius, radius, near, far);
  return multiply(projection, view);
}

/**
 * 点に行列を適用する（同次座標で割り戻す）
 * 主にテストと当たり判定の確認に使う。
 */
export function transformPoint(m, [x, y, z]) {
  const out = [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w !== 0 && w !== 1) {
    return [out[0] / w, out[1] / w, out[2] / w];
  }
  return out;
}

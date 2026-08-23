// 組み込みプリミティブ形状（仕様書6.2.5節）
//
// 3Dモデルを用意しなくても、床・壁・弾などを手早く置けるようにする。
// どの形も **原点を中心とした 1×1×1 に収める**。大きさは `SCALEX/Y/Z` で決める。
//
// WebGL に依存しないため単体テストできる。実際の描画は renderer.js が行う。

/** 使える形状名 */
export const PRIMITIVE_NAMES = ["box", "sphere", "plane", "cylinder", "cone"];

/** 球・円柱・円錐の分割数（滑らかさと頂点数の兼ね合い） */
const SEGMENTS = 24;
/** 球の縦方向の分割数 */
const RINGS = 16;

/** 組み込みの形状名かどうか */
export function isPrimitiveName(name) {
  if (typeof name !== "string" || name === "") return false;
  return PRIMITIVE_NAMES.includes(name.toLowerCase());
}

/**
 * 形状を作る
 *
 * @returns `{ positions, normals, colors, indices }`。知らない名前なら `null`
 */
export function buildPrimitive(name) {
  if (!isPrimitiveName(name)) return null;
  switch (name.toLowerCase()) {
    case "box":
      return box();
    case "sphere":
      return sphere();
    case "plane":
      return plane();
    case "cylinder":
      return cylinder();
    default:
      return cone();
  }
}

/** 組み立て中の頂点をためる入れ物 */
function builder() {
  const positions = [];
  const normals = [];
  const indices = [];
  return {
    positions,
    normals,
    indices,
    /** 頂点を1つ足して、その番号を返す */
    vertex(px, py, pz, nx, ny, nz) {
      positions.push(px, py, pz);
      normals.push(nx, ny, nz);
      return positions.length / 3 - 1;
    },
    /** 三角形を1枚足す */
    face(a, b, c) {
      indices.push(a, b, c);
    },
    /** 描画に渡せる形にまとめる（色は白でそろえる） */
    done() {
      const count = positions.length / 3;
      return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        colors: new Float32Array(count * 4).fill(1),
        indices: new Uint16Array(indices),
      };
    },
  };
}

/** 直方体（1×1×1） */
function box() {
  const b = builder();
  // 面ごとに頂点を分けることで、辺をはっきり見せる（法線を共有しない）
  const faces = [
    { normal: [0, 0, 1], axis: [[1, 0, 0], [0, 1, 0]] }, // 手前
    { normal: [0, 0, -1], axis: [[-1, 0, 0], [0, 1, 0]] }, // 奥
    { normal: [1, 0, 0], axis: [[0, 0, -1], [0, 1, 0]] }, // 右
    { normal: [-1, 0, 0], axis: [[0, 0, 1], [0, 1, 0]] }, // 左
    { normal: [0, 1, 0], axis: [[1, 0, 0], [0, 0, -1]] }, // 上
    { normal: [0, -1, 0], axis: [[1, 0, 0], [0, 0, 1]] }, // 下
  ];
  for (const { normal, axis } of faces) {
    const [u, v] = axis;
    const corner = (su, sv) =>
      b.vertex(
        (normal[0] + su * u[0] + sv * v[0]) / 2,
        (normal[1] + su * u[1] + sv * v[1]) / 2,
        (normal[2] + su * u[2] + sv * v[2]) / 2,
        ...normal,
      );
    const a = corner(-1, -1);
    const c = corner(1, -1);
    const d = corner(1, 1);
    const e = corner(-1, 1);
    b.face(a, c, d);
    b.face(a, d, e);
  }
  return b.done();
}

/** 球（直径1） */
function sphere() {
  const b = builder();
  const radius = 0.5;
  for (let ring = 0; ring <= RINGS; ring += 1) {
    // 上から下へ
    const phi = (ring / RINGS) * Math.PI;
    for (let seg = 0; seg <= SEGMENTS; seg += 1) {
      const theta = (seg / SEGMENTS) * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      b.vertex(nx * radius, ny * radius, nz * radius, nx, ny, nz);
    }
  }
  const stride = SEGMENTS + 1;
  for (let ring = 0; ring < RINGS; ring += 1) {
    for (let seg = 0; seg < SEGMENTS; seg += 1) {
      const a = ring * stride + seg;
      const c = a + stride;
      b.face(a, c, a + 1);
      b.face(a + 1, c, c + 1);
    }
  }
  return b.done();
}

/** 平面（XY平面に立つ 1×1 の板。手前を向く） */
function plane() {
  const b = builder();
  const a = b.vertex(-0.5, -0.5, 0, 0, 0, 1);
  const c = b.vertex(0.5, -0.5, 0, 0, 0, 1);
  const d = b.vertex(0.5, 0.5, 0, 0, 0, 1);
  const e = b.vertex(-0.5, 0.5, 0, 0, 0, 1);
  b.face(a, c, d);
  b.face(a, d, e);
  return b.done();
}

/** 上面・底面のふたを張る */
function cap(b, y, ny, radius) {
  const center = b.vertex(0, y, 0, 0, ny, 0);
  const rim = [];
  for (let seg = 0; seg < SEGMENTS; seg += 1) {
    const theta = (seg / SEGMENTS) * Math.PI * 2;
    rim.push(b.vertex(Math.cos(theta) * radius, y, Math.sin(theta) * radius, 0, ny, 0));
  }
  for (let seg = 0; seg < SEGMENTS; seg += 1) {
    const next = (seg + 1) % SEGMENTS;
    // 上下で表裏が逆になるため、頂点の並び順を入れ替える
    if (ny > 0) b.face(center, rim[seg], rim[next]);
    else b.face(center, rim[next], rim[seg]);
  }
}

/** 円柱（直径1・高さ1） */
function cylinder() {
  const b = builder();
  const radius = 0.5;
  const side = [];
  for (let seg = 0; seg <= SEGMENTS; seg += 1) {
    const theta = (seg / SEGMENTS) * Math.PI * 2;
    const nx = Math.cos(theta);
    const nz = Math.sin(theta);
    side.push([
      b.vertex(nx * radius, 0.5, nz * radius, nx, 0, nz),
      b.vertex(nx * radius, -0.5, nz * radius, nx, 0, nz),
    ]);
  }
  for (let seg = 0; seg < SEGMENTS; seg += 1) {
    const [topA, bottomA] = side[seg];
    const [topB, bottomB] = side[seg + 1];
    b.face(topA, bottomA, bottomB);
    b.face(topA, bottomB, topB);
  }
  cap(b, 0.5, 1, radius);
  cap(b, -0.5, -1, radius);
  return b.done();
}

/** 円錐（底面の直径1・高さ1。頂点は真上） */
function cone() {
  const b = builder();
  const radius = 0.5;
  // 斜面の傾きに合わせて法線を傾ける（高さ1・半径0.5 なので比は 1:2）
  const slope = radius / 1.0;
  const length = Math.hypot(1, slope);
  for (let seg = 0; seg < SEGMENTS; seg += 1) {
    const mid = ((seg + 0.5) / SEGMENTS) * Math.PI * 2;
    const theta = (seg / SEGMENTS) * Math.PI * 2;
    const next = ((seg + 1) / SEGMENTS) * Math.PI * 2;
    // 頂点は面ごとに分ける（1点に法線をまとめると尖りが潰れるため）
    const apex = b.vertex(0, 0.5, 0, Math.cos(mid) / length, slope / length, Math.sin(mid) / length);
    const a = b.vertex(
      Math.cos(theta) * radius,
      -0.5,
      Math.sin(theta) * radius,
      Math.cos(theta) / length,
      slope / length,
      Math.sin(theta) / length,
    );
    const c = b.vertex(
      Math.cos(next) * radius,
      -0.5,
      Math.sin(next) * radius,
      Math.cos(next) / length,
      slope / length,
      Math.sin(next) / length,
    );
    b.face(apex, a, c);
  }
  cap(b, -0.5, -1, radius);
  return b.done();
}

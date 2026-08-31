#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Arcadeer デフォルトキャラクター（デフォルメ猫）glTF(.glb) 生成スクリプト

- 外部依存なし（Python 標準ライブラリのみ）
- ボーン(スケルトン)＋リジッドスキニングを内包
- アニメーション4種「Walk / Run / Jump / Down」を内包
- 複数パーツを頂点カラー(COLOR_0)で色分け
- **二足歩行風**（胴体を立て、前脚を腕にした立ち姿）
- 出力: web/templates/assets/default-cat.glb（オレンジ）
        web/templates/assets/default-cat-white.glb（白）

座標系: glTF 標準 (Y-up / 右手系 / -Z が前方)
"""

import json
import math
import os
import struct

# ---------------------------------------------------------------------------
# 基本ベクトル・行列ユーティリティ
# ---------------------------------------------------------------------------

def v_sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])

def v_add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])

def v_scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)

def v_len(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])

def v_norm(a):
    l = v_len(a)
    if l < 1e-12:
        return (0.0, 0.0, 0.0)
    return (a[0] / l, a[1] / l, a[2] / l)

def v_cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )

def v_dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

def mat3_mul_vec(m, v):
    # m は行優先 3x3 (3要素タプル x3)
    return (
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    )

def mat3_identity():
    return ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))

def axis_angle_to_mat3(axis, angle):
    axis = v_norm(axis)
    x, y, z = axis
    c = math.cos(angle)
    s = math.sin(angle)
    t = 1.0 - c
    return (
        (t * x * x + c,     t * x * y - s * z, t * x * z + s * y),
        (t * x * y + s * z, t * y * y + c,     t * y * z - s * x),
        (t * x * z - s * y, t * y * z + s * x, t * z * z + c),
    )

def rot_from_y_to(direction):
    """ローカル +Y を direction 方向へ向ける回転行列を返す。"""
    d = v_norm(direction)
    up = (0.0, 1.0, 0.0)
    dot = v_dot(up, d)
    if dot > 0.99999:
        return mat3_identity()
    if dot < -0.99999:
        return axis_angle_to_mat3((1.0, 0.0, 0.0), math.pi)
    axis = v_cross(up, d)
    angle = math.acos(max(-1.0, min(1.0, dot)))
    return axis_angle_to_mat3(axis, angle)

def quat_axis_angle(axis, angle):
    """glTF 形式 [x, y, z, w] のクォータニオンを返す。"""
    axis = v_norm(axis)
    h = angle * 0.5
    s = math.sin(h)
    return (axis[0] * s, axis[1] * s, axis[2] * s, math.cos(h))

# ---------------------------------------------------------------------------
# ジオメトリ蓄積バッファ
# ---------------------------------------------------------------------------

positions = []   # (x, y, z)
normals = []     # (x, y, z)
colors = []      # (r, g, b, a)
joints = []      # (j0, j1, j2, j3)
weights = []     # (w0, w1, w2, w3)
indices = []     # int


def add_triangle_indices(base, tri):
    indices.extend((base + tri[0], base + tri[1], base + tri[2]))


def add_ellipsoid(center, radii, color, joint, rot=None, seg_u=20, seg_v=14):
    """楕円体（球をスケール／回転）を追加。法線は解析的に算出。"""
    if rot is None:
        rot = mat3_identity()
    rx, ry, rz = radii
    base = len(positions)
    ring_count = seg_v + 1
    col_count = seg_u + 1
    for iv in range(ring_count):
        lat = -math.pi / 2.0 + math.pi * (iv / seg_v)
        cl = math.cos(lat)
        sl = math.sin(lat)
        for iu in range(col_count):
            lon = 2.0 * math.pi * (iu / seg_u)
            px = cl * math.cos(lon)
            py = sl
            pz = cl * math.sin(lon)
            # スケール
            local_pos = (px * rx, py * ry, pz * rz)
            # 楕円体の法線
            local_nrm = v_norm((px / rx, py / ry, pz / rz)) if (rx and ry and rz) else (px, py, pz)
            # 回転＋平行移動
            wp = v_add(mat3_mul_vec(rot, local_pos), center)
            wn = v_norm(mat3_mul_vec(rot, local_nrm))
            positions.append(wp)
            normals.append(wn)
            colors.append(color)
            joints.append((joint, 0, 0, 0))
            weights.append((1.0, 0.0, 0.0, 0.0))
    for iv in range(seg_v):
        for iu in range(seg_u):
            a = iv * col_count + iu
            b = a + col_count
            add_triangle_indices(base, (a, b, a + 1))
            add_triangle_indices(base, (a + 1, b, b + 1))


def add_capsule(p0, p1, radius, color, joint, seg_u=12, seg_v=8):
    """p0→p1 を結ぶカプセル（円柱＋半球キャップ）。長さ0なら球。"""
    axis = v_sub(p1, p0)
    length = v_len(axis)
    rot = rot_from_y_to(axis if length > 1e-9 else (0.0, 1.0, 0.0))
    base = len(positions)
    cap_rings = max(2, seg_v // 2)
    rings = []  # (center_local_y_offset, lat)
    # 下半球: lat -90..0、中心 y=0
    for k in range(cap_rings + 1):
        lat = -math.pi / 2.0 + (math.pi / 2.0) * (k / cap_rings)
        rings.append((0.0, lat))
    # 上半球: lat 0..90、中心 y=length
    for k in range(1, cap_rings + 1):
        lat = (math.pi / 2.0) * (k / cap_rings)
        rings.append((length, lat))
    col_count = seg_u + 1
    for (cy, lat) in rings:
        cl = math.cos(lat)
        sl = math.sin(lat)
        for iu in range(col_count):
            lon = 2.0 * math.pi * (iu / seg_u)
            local_pos = (cl * math.cos(lon) * radius, cy + sl * radius, cl * math.sin(lon) * radius)
            local_nrm = v_norm((cl * math.cos(lon), sl, cl * math.sin(lon)))
            wp = v_add(mat3_mul_vec(rot, local_pos), p0)
            wn = v_norm(mat3_mul_vec(rot, local_nrm))
            positions.append(wp)
            normals.append(wn)
            colors.append(color)
            joints.append((joint, 0, 0, 0))
            weights.append((1.0, 0.0, 0.0, 0.0))
    ring_total = len(rings)
    for iv in range(ring_total - 1):
        for iu in range(seg_u):
            a = iv * col_count + iu
            b = a + col_count
            add_triangle_indices(base, (a, b, a + 1))
            add_triangle_indices(base, (a + 1, b, b + 1))


def add_cone(base_center, radius, apex, color, joint, seg=14):
    """円錐（耳など）。底面キャップ付き。"""
    axis = v_sub(apex, base_center)
    height = v_len(axis)
    rot = rot_from_y_to(axis)
    base = len(positions)
    slope_y = (radius / height) if height > 1e-9 else 0.0
    col_count = seg + 1
    # 側面: 底リング
    for iu in range(col_count):
        lon = 2.0 * math.pi * (iu / seg)
        local_pos = (radius * math.cos(lon), 0.0, radius * math.sin(lon))
        local_nrm = v_norm((math.cos(lon), slope_y, math.sin(lon)))
        wp = v_add(mat3_mul_vec(rot, local_pos), base_center)
        wn = v_norm(mat3_mul_vec(rot, local_nrm))
        positions.append(wp)
        normals.append(wn)
        colors.append(color)
        joints.append((joint, 0, 0, 0))
        weights.append((1.0, 0.0, 0.0, 0.0))
    # 頂点
    apex_idx_local = col_count
    wp = apex
    wn = v_norm(mat3_mul_vec(rot, (0.0, 1.0, 0.0)))
    positions.append(wp)
    normals.append(wn)
    colors.append(color)
    joints.append((joint, 0, 0, 0))
    weights.append((1.0, 0.0, 0.0, 0.0))
    for iu in range(seg):
        add_triangle_indices(base, (iu, iu + 1, apex_idx_local))
    # 底面キャップ
    cap_base = len(positions)
    center_nrm = v_norm(mat3_mul_vec(rot, (0.0, -1.0, 0.0)))
    positions.append(base_center)
    normals.append(center_nrm)
    colors.append(color)
    joints.append((joint, 0, 0, 0))
    weights.append((1.0, 0.0, 0.0, 0.0))
    for iu in range(col_count):
        lon = 2.0 * math.pi * (iu / seg)
        local_pos = (radius * math.cos(lon), 0.0, radius * math.sin(lon))
        wp = v_add(mat3_mul_vec(rot, local_pos), base_center)
        positions.append(wp)
        normals.append(center_nrm)
        colors.append(color)
        joints.append((joint, 0, 0, 0))
        weights.append((1.0, 0.0, 0.0, 0.0))
    for iu in range(seg):
        add_triangle_indices(cap_base, (0, iu + 2, iu + 1))


# ---------------------------------------------------------------------------
# スケルトン定義（グローバル静止姿勢）
# ---------------------------------------------------------------------------

JOINT_NAMES = [
    "hips", "spine", "head", "ear_L", "ear_R",
    "arm_L", "arm_R", "leg_L", "leg_R",
    "tail1", "tail2", "tail3",
]
J = {name: i for i, name in enumerate(JOINT_NAMES)}

# 二足歩行風の立ち姿。腰から上へ背骨・頭、肩から腕、腰から脚を下ろす。
# しっぽは腰の後ろ（+Z）へ流す（-Z が前方）
GLOBAL = {
    "hips":   (0.00, 0.62, 0.00),
    "spine":  (0.00, 0.92, 0.00),
    "head":   (0.00, 1.28, 0.00),
    "ear_L":  (-0.13, 1.50, 0.00),
    "ear_R":  (0.13, 1.50, 0.00),
    "arm_L":  (-0.26, 1.02, 0.00),
    "arm_R":  (0.26, 1.02, 0.00),
    "leg_L":  (-0.13, 0.58, 0.00),
    "leg_R":  (0.13, 0.58, 0.00),
    "tail1":  (0.00, 0.62, 0.24),
    "tail2":  (0.00, 0.78, 0.42),
    "tail3":  (0.00, 0.96, 0.50),
}

# 親子関係（ノード階層）
PARENT = {
    "hips": None,
    "spine": "hips",
    "head": "spine",
    "ear_L": "head",
    "ear_R": "head",
    "arm_L": "spine",
    "arm_R": "spine",
    "leg_L": "hips",
    "leg_R": "hips",
    "tail1": "hips",
    "tail2": "tail1",
    "tail3": "tail2",
}

def local_translation(name):
    g = GLOBAL[name]
    p = PARENT[name]
    if p is None:
        return g
    return v_sub(g, GLOBAL[p])

# ---------------------------------------------------------------------------
# カラーパレット（複数パーツ色分け）
# ---------------------------------------------------------------------------

# 毛色ごとの組。fur を変えるだけで別の猫になるよう、部位ごとに持つ
PALETTES = {
    "default-cat.glb": {
        "fur":     (0.91, 0.58, 0.30, 1.0),   # 体・頭（オレンジ）
        "ear":     (0.66, 0.38, 0.18, 1.0),   # 耳（濃いオレンジ）
        "muzzle":  (0.97, 0.93, 0.85, 1.0),   # 口まわり（クリーム）
        "nose":    (0.92, 0.50, 0.52, 1.0),   # 鼻（ピンク）
        "eye":     (0.12, 0.12, 0.14, 1.0),   # 目（黒）
        "paw":     (0.95, 0.90, 0.80, 1.0),   # 手足（クリーム）
        "belly":   (0.97, 0.93, 0.85, 1.0),   # お腹（クリーム）
        "tail":    (0.91, 0.58, 0.30, 1.0),   # しっぽ
        "tailtip": (0.66, 0.38, 0.18, 1.0),   # しっぽ先端
    },
    "default-cat-white.glb": {
        # 白猫。真っ白だと陰影が飛ぶため、少しだけ灰色を混ぜる
        "fur":     (0.96, 0.95, 0.94, 1.0),
        "ear":     (0.80, 0.75, 0.76, 1.0),
        "muzzle":  (1.00, 0.99, 0.98, 1.0),
        "nose":    (0.94, 0.60, 0.62, 1.0),
        "eye":     (0.16, 0.20, 0.30, 1.0),   # 白猫は青みがかった目にする
        "paw":     (1.00, 0.99, 0.98, 1.0),
        "belly":   (1.00, 0.99, 0.98, 1.0),
        "tail":    (0.96, 0.95, 0.94, 1.0),
        "tailtip": (0.80, 0.75, 0.76, 1.0),
    },
}

# いま組み立てている毛色（build_mesh の前に差し替える）
palette = PALETTES["default-cat.glb"]

# ---------------------------------------------------------------------------
# メッシュ構築
# ---------------------------------------------------------------------------

def build_mesh():
    """二足歩行風の立ち姿を組み立てる。

    胴体を縦長にして立たせ、肩から腕、腰から脚を下ろす。
    四つ足のときと違い、**しっぽは体を支える向き（後ろへ）**に流す。
    """
    c = palette

    # 胴体（縦長の楕円体）
    add_ellipsoid((0.0, 0.86, 0.0), (0.26, 0.34, 0.22), c["fur"], J["spine"], seg_u=24, seg_v=16)
    # お腹（前面に薄く重ねて色を分ける）
    add_ellipsoid((0.0, 0.82, -0.10), (0.17, 0.24, 0.14), c["belly"], J["spine"], seg_u=20, seg_v=14)
    # 腰
    add_ellipsoid((0.0, 0.62, 0.0), (0.22, 0.18, 0.20), c["fur"], J["hips"], seg_u=20, seg_v=14)

    # 頭
    add_ellipsoid((0.0, 1.28, 0.0), (0.27, 0.26, 0.26), c["fur"], J["head"], seg_u=24, seg_v=16)
    # 口まわり
    add_ellipsoid((0.0, 1.21, -0.20), (0.14, 0.11, 0.12), c["muzzle"], J["head"], seg_u=16, seg_v=12)
    # 鼻
    add_ellipsoid((0.0, 1.23, -0.30), (0.035, 0.03, 0.03), c["nose"], J["head"], seg_u=12, seg_v=8)
    # 目
    add_ellipsoid((-0.10, 1.33, -0.20), (0.045, 0.05, 0.045), c["eye"], J["head"], seg_u=12, seg_v=10)
    add_ellipsoid((0.10, 1.33, -0.20), (0.045, 0.05, 0.045), c["eye"], J["head"], seg_u=12, seg_v=10)
    # 耳（円錐）
    add_cone((-0.13, 1.43, 0.02), 0.10, (-0.17, 1.64, 0.0), c["ear"], J["ear_L"], seg=16)
    add_cone((0.13, 1.43, 0.02), 0.10, (0.17, 1.64, 0.0), c["ear"], J["ear_R"], seg=16)

    # 腕（肩→手先）
    arm_r = 0.070
    for arm, sign in (("arm_L", -1.0), ("arm_R", 1.0)):
        gx, gy, gz = GLOBAL[arm]
        tip = (gx + sign * 0.05, 0.68, gz - 0.02)
        add_capsule((gx, gy, gz), tip, arm_r, c["fur"], J[arm], seg_u=12, seg_v=8)
        # 手（先端を色分け）
        add_ellipsoid(tip, (0.085, 0.075, 0.085), c["paw"], J[arm], seg_u=12, seg_v=10)

    # 脚（腰→足首）と足
    leg_r = 0.085
    for leg in ("leg_L", "leg_R"):
        gx, gy, gz = GLOBAL[leg]
        ankle = (gx, 0.10, gz)
        add_capsule((gx, gy, gz), ankle, leg_r, c["fur"], J[leg], seg_u=12, seg_v=8)
        # 足（前方へ伸ばして立ち姿を安定させる）
        add_ellipsoid((gx, 0.07, gz - 0.06), (0.10, 0.06, 0.16), c["paw"], J[leg], seg_u=14, seg_v=10)

    # しっぽ（3 セグメント、各セグメントを下位関節にバインド）
    add_capsule(GLOBAL["tail1"], GLOBAL["tail2"], 0.080, c["tail"], J["tail1"], seg_u=12, seg_v=8)
    add_capsule(GLOBAL["tail2"], GLOBAL["tail3"], 0.062, c["tail"], J["tail2"], seg_u=12, seg_v=8)
    add_ellipsoid(GLOBAL["tail3"], (0.07, 0.07, 0.07), c["tailtip"], J["tail3"], seg_u=14, seg_v=10)

# ---------------------------------------------------------------------------
# バイナリバッファ構築
# ---------------------------------------------------------------------------

FLOAT = 5126
UBYTE = 5121
USHORT = 5123
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963

bin_data = bytearray()
buffer_views = []
accessors = []

def align4():
    while len(bin_data) % 4 != 0:
        bin_data.append(0)

def add_buffer_view(byte_data, target=None):
    align4()
    offset = len(bin_data)
    bin_data.extend(byte_data)
    bv = {"buffer": 0, "byteOffset": offset, "byteLength": len(byte_data)}
    if target is not None:
        bv["target"] = target
    buffer_views.append(bv)
    return len(buffer_views) - 1

def add_accessor_vec3_float(data, target, with_minmax=False):
    flat = bytearray()
    for v in data:
        flat += struct.pack("<3f", v[0], v[1], v[2])
    bv = add_buffer_view(flat, target)
    acc = {"bufferView": bv, "componentType": FLOAT, "count": len(data), "type": "VEC3"}
    if with_minmax:
        mn = [min(v[i] for v in data) for i in range(3)]
        mx = [max(v[i] for v in data) for i in range(3)]
        acc["min"] = mn
        acc["max"] = mx
    accessors.append(acc)
    return len(accessors) - 1

def add_accessor_vec4_float(data, target):
    flat = bytearray()
    for v in data:
        flat += struct.pack("<4f", v[0], v[1], v[2], v[3])
    bv = add_buffer_view(flat, target)
    accessors.append({"bufferView": bv, "componentType": FLOAT, "count": len(data), "type": "VEC4"})
    return len(accessors) - 1

def add_accessor_vec4_ubyte(data, target):
    flat = bytearray()
    for v in data:
        flat += struct.pack("<4B", v[0], v[1], v[2], v[3])
    bv = add_buffer_view(flat, target)
    accessors.append({"bufferView": bv, "componentType": UBYTE, "count": len(data), "type": "VEC4"})
    return len(accessors) - 1

def add_accessor_scalar_ushort(data, target):
    flat = bytearray()
    for v in data:
        flat += struct.pack("<H", v)
    bv = add_buffer_view(flat, target)
    accessors.append({"bufferView": bv, "componentType": USHORT, "count": len(data), "type": "SCALAR"})
    return len(accessors) - 1

def add_accessor_scalar_float(data):
    flat = bytearray()
    for v in data:
        flat += struct.pack("<f", v)
    bv = add_buffer_view(flat, None)
    acc = {"bufferView": bv, "componentType": FLOAT, "count": len(data), "type": "SCALAR",
           "min": [min(data)], "max": [max(data)]}
    accessors.append(acc)
    return len(accessors) - 1

def add_accessor_mat4_float(mats):
    flat = bytearray()
    for m in mats:
        flat += struct.pack("<16f", *m)
    bv = add_buffer_view(flat, None)
    accessors.append({"bufferView": bv, "componentType": FLOAT, "count": len(mats), "type": "MAT4"})
    return len(accessors) - 1

# ---------------------------------------------------------------------------
# アニメーション定義
# ---------------------------------------------------------------------------

def quats_about_x(angles):
    return [quat_axis_angle((1.0, 0.0, 0.0), a) for a in angles]

def quats_about_y(angles):
    return [quat_axis_angle((0.0, 1.0, 0.0), a) for a in angles]

def hips_translations(dys):
    base = local_translation("hips")
    return [(base[0], base[1] + dy, base[2]) for dy in dys]

def quats_about_z(angles):
    return [quat_axis_angle((0.0, 0.0, 1.0), a) for a in angles]


def build_animations():
    """二足歩行向けのアニメーション。

    腕と脚は**左右で位相を逆**にして、歩いているように見せる。
    振り幅はX軸まわり（前後）で、Z軸まわり（左右）は倒れる演出に使う。
    """
    anims = []

    # --- Walk（1.0秒ループ）---
    t = [0.0, 0.25, 0.5, 0.75, 1.0]
    fwd = [0.40, 0.0, -0.40, 0.0, 0.40]
    bwd = [-0.40, 0.0, 0.40, 0.0, -0.40]
    walk = {
        "name": "Walk",
        "channels": [
            # 腕と脚は左右で逆。さらに腕は脚と逆に振る（人が歩く形）
            ("leg_L", "rotation", t, quats_about_x(fwd)),
            ("leg_R", "rotation", t, quats_about_x(bwd)),
            ("arm_L", "rotation", t, quats_about_x(bwd)),
            ("arm_R", "rotation", t, quats_about_x(fwd)),
            # 一歩ごとに体が少し浮く
            ("hips", "translation", t, hips_translations([0.0, 0.03, 0.0, 0.03, 0.0])),
            ("spine", "rotation", t, quats_about_y([0.06, 0.0, -0.06, 0.0, 0.06])),
            ("tail1", "rotation", t, quats_about_y([0.18, 0.0, -0.18, 0.0, 0.18])),
            ("tail2", "rotation", t, quats_about_y([0.14, 0.0, -0.14, 0.0, 0.14])),
        ],
    }
    anims.append(walk)

    # --- Run（0.55秒ループ・大振幅）---
    t = [0.0, 0.1375, 0.275, 0.4125, 0.55]
    fwd = [0.75, 0.0, -0.75, 0.0, 0.75]
    bwd = [-0.75, 0.0, 0.75, 0.0, -0.75]
    run = {
        "name": "Run",
        "channels": [
            ("leg_L", "rotation", t, quats_about_x(fwd)),
            ("leg_R", "rotation", t, quats_about_x(bwd)),
            ("arm_L", "rotation", t, quats_about_x(bwd)),
            ("arm_R", "rotation", t, quats_about_x(fwd)),
            ("hips", "translation", t, hips_translations([0.0, 0.07, 0.0, 0.07, 0.0])),
            # 走るときは前傾する
            ("spine", "rotation", t, quats_about_x([-0.18, -0.22, -0.18, -0.22, -0.18])),
            ("tail1", "rotation", t, quats_about_x([-0.35, -0.42, -0.35, -0.42, -0.35])),
        ],
    }
    anims.append(run)

    # --- Jump（1.3秒・非ループ）---
    t = [0.0, 0.15, 0.35, 0.55, 0.8, 1.0, 1.3]
    leg_j = [0.0, 0.45, 0.10, -0.30, -0.20, 0.30, 0.0]
    arm_j = [0.0, 0.30, -0.60, -1.20, -0.95, -0.20, 0.0]
    jump = {
        "name": "Jump",
        "channels": [
            ("hips", "translation", t, hips_translations([0.0, -0.14, -0.05, 0.42, 0.20, -0.08, 0.0])),
            # しゃがんでから伸び上がる
            ("leg_L", "rotation", t, quats_about_x(leg_j)),
            ("leg_R", "rotation", t, quats_about_x(leg_j)),
            # 腕は上へ振り上げる
            ("arm_L", "rotation", t, quats_about_x(arm_j)),
            ("arm_R", "rotation", t, quats_about_x(arm_j)),
            ("spine", "rotation", t, quats_about_x([0.0, 0.22, 0.05, -0.15, -0.10, 0.12, 0.0])),
            ("tail1", "rotation", t, quats_about_x([0.0, 0.15, -0.20, -0.55, -0.45, 0.05, 0.0])),
        ],
    }
    anims.append(jump)

    # --- Down（1.4秒・非ループ）「やられたー！」 ---
    # のけぞる → 尻もち → 仰向けに倒れて手足をジタバタ。
    # **腰ごと後ろへ倒す**のが肝。背骨だけ曲げてもよろけて見えるだけで、
    # 倒れたようには見えない。
    t = [0.0, 0.10, 0.24, 0.40, 0.56, 0.70, 0.84, 0.98, 1.12, 1.40]
    # 腰の回転：のけぞり（マイナス）→ 一気に後ろへ倒れる（プラス）
    hips_x = [0.0, -0.30, 0.35, 1.00, 1.30, 1.32, 1.28, 1.32, 1.28, 1.30]
    # 腰の高さ：立っている → 尻もち → 寝そべる
    hips_dy = [0.0, 0.05, -0.20, -0.46, -0.56, -0.56, -0.56, -0.56, -0.56, -0.56]
    # 背骨：倒れた後は少しだけ起こして「まだもがいている」感じにする
    spine_x = [0.0, -0.25, 0.10, -0.20, -0.35, -0.22, -0.35, -0.22, -0.32, -0.30]
    # 頭：ガクガク揺れる
    head_x = [0.0, -0.35, 0.25, -0.15, 0.20, -0.10, 0.20, -0.10, 0.15, 0.10]
    # ジタバタ（左右で位相をずらす）。倒れた体に対して手足が宙で暴れる
    flail_a = [0.0, -0.45, -0.20, -1.30, -0.40, -1.35, -0.40, -1.35, -0.60, -0.90]
    flail_b = [0.0, -0.15, -0.70, -0.35, -1.35, -0.40, -1.35, -0.45, -1.25, -0.90]
    kick_a = [0.0, 0.25, 0.65, -0.20, -1.10, -0.25, -1.10, -0.30, -0.95, -0.70]
    kick_b = [0.0, 0.10, 0.30, -1.05, -0.25, -1.10, -0.30, -1.05, -0.35, -0.70]
    down = {
        "name": "Down",
        "channels": [
            ("hips", "translation", t, hips_translations(hips_dy)),
            ("hips", "rotation", t, quats_about_x(hips_x)),
            ("spine", "rotation", t, quats_about_x(spine_x)),
            ("head", "rotation", t, quats_about_x(head_x)),
            ("arm_L", "rotation", t, quats_about_x(flail_a)),
            ("arm_R", "rotation", t, quats_about_x(flail_b)),
            ("leg_L", "rotation", t, quats_about_x(kick_a)),
            ("leg_R", "rotation", t, quats_about_x(kick_b)),
            # しっぽも小刻みに振る
            ("tail1", "rotation", t, quats_about_y(
                [0.0, 0.25, -0.30, 0.40, -0.40, 0.40, -0.40, 0.35, -0.30, 0.0])),
            ("tail2", "rotation", t, quats_about_y(
                [0.0, -0.30, 0.35, -0.45, 0.45, -0.45, 0.45, -0.40, 0.35, 0.0])),
        ],
    }
    anims.append(down)
    return anims

# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def reset_buffers():
    """毛色ごとに作り直せるよう、ためこんだデータを空にする"""
    for buf in (positions, normals, colors, joints, weights, indices,
                buffer_views, accessors):
        buf.clear()
    bin_data.clear()


def main():
    for file_name in PALETTES:
        reset_buffers()
        globals()["palette"] = PALETTES[file_name]
        build_one(file_name)


def build_one(file_name):
    build_mesh()

    # 頂点属性アクセサ
    acc_pos = add_accessor_vec3_float(positions, ARRAY_BUFFER, with_minmax=True)
    acc_nrm = add_accessor_vec3_float(normals, ARRAY_BUFFER)
    acc_col = add_accessor_vec4_float(colors, ARRAY_BUFFER)
    acc_jnt = add_accessor_vec4_ubyte(joints, ARRAY_BUFFER)
    acc_wgt = add_accessor_vec4_float(weights, ARRAY_BUFFER)
    acc_idx = add_accessor_scalar_ushort(indices, ELEMENT_ARRAY_BUFFER)

    # 逆バインド行列（列優先 4x4 / 静止姿勢の平行移動の逆）
    ibms = []
    for name in JOINT_NAMES:
        g = GLOBAL[name]
        ibms.append([
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            -g[0], -g[1], -g[2], 1.0,
        ])
    acc_ibm = add_accessor_mat4_float(ibms)

    # ノード構築
    # node 0 = メッシュ(+skin)、node 1.. = 各ジョイント
    nodes = []
    nodes.append({"name": "Cat", "mesh": 0, "skin": 0})
    joint_node_index = {}
    for i, name in enumerate(JOINT_NAMES):
        joint_node_index[name] = i + 1
    for name in JOINT_NAMES:
        lt = local_translation(name)
        node = {"name": name, "translation": [lt[0], lt[1], lt[2]]}
        children = [joint_node_index[c] for c in JOINT_NAMES if PARENT[c] == name]
        if children:
            node["children"] = children
        nodes.append(node)

    skin = {
        "skeleton": joint_node_index["hips"],
        "joints": [joint_node_index[n] for n in JOINT_NAMES],
        "inverseBindMatrices": acc_ibm,
    }

    material = {
        "name": "CatMaterial",
        "pbrMetallicRoughness": {
            "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
            "metallicFactor": 0.0,
            "roughnessFactor": 0.85,
        },
    }

    mesh = {
        "name": "CatMesh",
        "primitives": [{
            "attributes": {
                "POSITION": acc_pos,
                "NORMAL": acc_nrm,
                "COLOR_0": acc_col,
                "JOINTS_0": acc_jnt,
                "WEIGHTS_0": acc_wgt,
            },
            "indices": acc_idx,
            "material": 0,
        }],
    }

    # アニメーション
    gltf_animations = []
    for anim in build_animations():
        samplers = []
        channels = []
        for (target_name, path, times, values) in anim["channels"]:
            in_acc = add_accessor_scalar_float(times)
            if path == "rotation":
                out_acc = add_accessor_vec4_float(values, None)
            else:  # translation
                out_acc = add_accessor_vec3_float(values, None)
            samplers.append({"input": in_acc, "output": out_acc, "interpolation": "LINEAR"})
            channels.append({
                "sampler": len(samplers) - 1,
                "target": {"node": joint_node_index[target_name], "path": path},
            })
        gltf_animations.append({"name": anim["name"], "samplers": samplers, "channels": channels})

    gltf = {
        "asset": {"version": "2.0", "generator": "Arcadeer gen_cat_glb.py"},
        "scene": 0,
        "scenes": [{"name": "Scene", "nodes": [0, joint_node_index["hips"]]}],
        "nodes": nodes,
        "meshes": [mesh],
        "materials": [material],
        "skins": [skin],
        "animations": gltf_animations,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(bin_data)}],
    }

    write_glb(gltf, bin_data, file_name)


def write_glb(gltf, bin_bytes, file_name):
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4 != 0:
        json_bytes += b" "
    bin_padded = bytearray(bin_bytes)
    while len(bin_padded) % 4 != 0:
        bin_padded.append(0)

    total = 12 + 8 + len(json_bytes) + 8 + len(bin_padded)
    out = bytearray()
    out += struct.pack("<III", 0x46546C67, 2, total)  # magic, version, length
    out += struct.pack("<II", len(json_bytes), 0x4E4F534A)  # JSON chunk
    out += json_bytes
    out += struct.pack("<II", len(bin_padded), 0x004E4942)  # BIN chunk
    out += bin_padded

    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.normpath(os.path.join(here, "..", "web", "templates", "assets", file_name))
    with open(out_path, "wb") as f:
        f.write(out)

    print("出力:", out_path)
    print("  頂点数:", len(positions), "/ 三角形数:", len(indices) // 3)
    print("  ジョイント数:", len(JOINT_NAMES))
    print("  アニメーション:", [a["name"] for a in gltf["animations"]])
    print("  ファイルサイズ:", len(out), "bytes")

    # 簡易自己検証
    assert len(normals) == len(positions)
    assert len(colors) == len(positions)
    assert len(joints) == len(positions)
    assert len(weights) == len(positions)
    assert max(indices) < len(positions)
    assert len(positions) < 65536, "ushort インデックスの範囲を超過"
    print("  自己検証: OK")


if __name__ == "__main__":
    main()

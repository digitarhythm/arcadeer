#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Arcadeer デフォルトプロジェクトアイコン (512x512 PNG) 生成スクリプト

- 外部依存なし（Python 標準ライブラリのみ）
- デフォルトキャラクター（デフォルメ猫 default-cat.glb）と同系配色の猫フェイス
- 2x スーパーサンプリングでエッジを滑らかに描画
- 出力: web/templates/assets/default-icon.png
"""

import os
import struct
import zlib

SIZE = 512          # 出力サイズ
SS = 2              # スーパーサンプリング倍率

# ---------------------------------------------------------------------------
# カラーパレット（default-cat.glb と同系色）
# ---------------------------------------------------------------------------
BG      = (35, 35, 54)      # 背景 (#232336)
FUR     = (232, 148, 77)    # 体・頭（オレンジ）
EAR_IN  = (168, 97, 46)     # 耳の内側（濃いオレンジ）
MUZZLE  = (247, 237, 217)   # 口まわり（クリーム）
NOSE    = (235, 128, 133)   # 鼻（ピンク）
EYE     = (30, 30, 36)      # 目（黒）
WHISKER = (226, 232, 240)   # ヒゲ（ライトグレー）

# ---------------------------------------------------------------------------
# 形状判定
# ---------------------------------------------------------------------------

def in_rounded_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r

def in_circle(x, y, cx, cy, r):
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r

def in_ellipse(x, y, cx, cy, rx, ry):
    dx = (x - cx) / rx
    dy = (y - cy) / ry
    return dx * dx + dy * dy <= 1.0

def in_triangle(x, y, a, b, c):
    def cross(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    d1 = cross(a, b, (x, y))
    d2 = cross(b, c, (x, y))
    d3 = cross(c, a, (x, y))
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)

def in_rect(x, y, x0, y0, x1, y1):
    return x0 <= x <= x1 and y0 <= y <= y1

# ---------------------------------------------------------------------------
# 1サンプル点の色（512座標系）
# ---------------------------------------------------------------------------

def sample(x, y):
    # 背景の角丸矩形（外側は透明）
    if not in_rounded_rect(x, y, 6, 6, 506, 506, 80):
        return (0, 0, 0, 0)
    color = BG
    # 外耳（顔の下に描く）
    if in_triangle(x, y, (118, 240), (148, 64), (262, 152)):
        color = FUR
    if in_triangle(x, y, (394, 240), (364, 64), (250, 152)):
        color = FUR
    # 顔
    if in_circle(x, y, 256, 300, 150):
        color = FUR
    # 内耳
    if in_triangle(x, y, (152, 212), (166, 110), (238, 162)):
        color = EAR_IN
    if in_triangle(x, y, (360, 212), (346, 110), (274, 162)):
        color = EAR_IN
    # 口まわり
    if in_ellipse(x, y, 256, 352, 70, 50):
        color = MUZZLE
    # 鼻
    if in_triangle(x, y, (238, 336), (274, 336), (256, 360)):
        color = NOSE
    # 目
    if in_ellipse(x, y, 198, 282, 16, 26):
        color = EYE
    if in_ellipse(x, y, 314, 282, 16, 26):
        color = EYE
    # ヒゲ（左右2本ずつ）
    if in_rect(x, y, 88, 336, 178, 341) or in_rect(x, y, 96, 362, 178, 367):
        color = WHISKER
    if in_rect(x, y, 334, 336, 424, 341) or in_rect(x, y, 334, 362, 416, 367):
        color = WHISKER
    return (color[0], color[1], color[2], 255)

# ---------------------------------------------------------------------------
# レンダリング（SS x SS サブサンプル平均）
# ---------------------------------------------------------------------------

def render():
    rows = []
    inv = 1.0 / (SS * SS)
    for py in range(SIZE):
        row = bytearray()
        for px in range(SIZE):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    x = px + (sx + 0.5) / SS
                    y = py + (sy + 0.5) / SS
                    sr, sg, sb, sa = sample(x, y)
                    r += sr
                    g += sg
                    b += sb
                    a += sa
            row += bytes((int(r * inv + 0.5), int(g * inv + 0.5),
                          int(b * inv + 0.5), int(a * inv + 0.5)))
        rows.append(bytes(row))
    return rows

# ---------------------------------------------------------------------------
# PNG 書き出し（RGBA / 8bit）
# ---------------------------------------------------------------------------

def png_chunk(tag, payload):
    out = struct.pack(">I", len(payload)) + tag + payload
    out += struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    return out

def write_png(rows, path):
    raw = b"".join(b"\x00" + row for row in rows)  # フィルタ: None
    data = b"\x89PNG\r\n\x1a\n"
    data += png_chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
    data += png_chunk(b"IDAT", zlib.compress(raw, 9))
    data += png_chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)
    return len(data)

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.normpath(
        os.path.join(here, "..", "web", "templates", "assets", "default-icon.png"))
    rows = render()
    size = write_png(rows, out_path)
    print("出力:", out_path)
    print("  サイズ:", SIZE, "x", SIZE, "/ RGBA")
    print("  ファイルサイズ:", size, "bytes")

if __name__ == "__main__":
    main()

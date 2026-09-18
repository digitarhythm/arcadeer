#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Arcadeer デフォルト2Dキャラクター（猫のアニメパターン画像）生成スクリプト

- 外部依存なし（Python 標準ライブラリのみ）
- 32x32 のコマを横8列・縦2段（256x64、RGBA）で並べる
- 上の段はオレンジの猫、下の段は白い猫（default-cat.glb / default-cat-white.glb と同じ配色）
- 横向き（右向き）。@SCALEX = -1 で左を向く
- 出力: web/templates/assets/default-cat.png

コマの割り当て（上の段。白い猫は +8）
  0      : 立ち
  1, 2, 3: 歩き（1 → 2 → 3 → 2 → 1 と回すと自然）
  4, 5   : ジャンプ（上がる / 落ちる）
  6, 7   : やられた（ジタバタ）
"""

import os
import struct
import zlib

CELL = 32          # コマの一辺
COLUMNS = 8        # 横のコマ数
ROWS = 2           # 縦のコマ数
WIDTH = CELL * COLUMNS
HEIGHT = CELL * ROWS

# ---------------------------------------------------------------------------
# 配色（default-cat.glb / default-cat-white.glb と同系色）
# ---------------------------------------------------------------------------
PALETTES = [
    {   # オレンジの猫
        "fur": (232, 148, 77),
        "dark": (168, 97, 46),
        "line": (96, 52, 24),
        "muzzle": (247, 237, 217),
        "ear": (235, 128, 133),
    },
    {   # 白い猫
        "fur": (245, 245, 245),
        "dark": (200, 200, 206),
        "line": (90, 90, 100),
        "muzzle": (255, 250, 240),
        "ear": (240, 150, 160),
    },
]
EYE = (30, 30, 36)
EYE_WHITE = (255, 255, 255)
NOSE = (235, 128, 133)

# ---------------------------------------------------------------------------
# 1コマぶんのキャンバス（32x32 RGBA）
# ---------------------------------------------------------------------------

class Cell:
    def __init__(self):
        self.px = [[None] * CELL for _ in range(CELL)]

    def put(self, x, y, color):
        x = int(x)
        y = int(y)
        if 0 <= x < CELL and 0 <= y < CELL:
            self.px[y][x] = color

    def rect(self, x0, y0, x1, y1, color):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.put(x, y, color)

    def ellipse(self, cx, cy, rx, ry, color):
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                dx = (x + 0.5 - cx) / rx
                dy = (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1.0:
                    self.put(x, y, color)

    def triangle(self, a, b, c, color):
        def cross(p, q, r):
            return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        xs = [a[0], b[0], c[0]]
        ys = [a[1], b[1], c[1]]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            for x in range(int(min(xs)), int(max(xs)) + 1):
                p = (x + 0.5, y + 0.5)
                d1 = cross(a, b, p)
                d2 = cross(b, c, p)
                d3 = cross(c, a, p)
                neg = d1 < 0 or d2 < 0 or d3 < 0
                pos = d1 > 0 or d2 > 0 or d3 > 0
                if not (neg and pos):
                    self.put(x, y, color)

    def outline(self, color):
        """塗った部分のふちを1ピクセルだけ線の色にする（外へは広げない）"""
        src = [row[:] for row in self.px]
        for y in range(CELL):
            for x in range(CELL):
                if src[y][x] is None:
                    continue
                edge = False
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx = x + dx
                    ny = y + dy
                    if nx < 0 or ny < 0 or nx >= CELL or ny >= CELL or src[ny][nx] is None:
                        edge = True
                        break
                if edge:
                    self.px[y][x] = color

# ---------------------------------------------------------------------------
# 猫の描画（右向き）
# ---------------------------------------------------------------------------

def draw_cat(cell, pal, pose):
    """
    pose のキー
      body_dy  : 体全体の上下（負で上へ）
      legs     : [(x, 長さ), (x, 長さ)] 足の位置と長さ
      arms     : "down" / "up" / "out"
      tail     : "up" / "down"
      eyes     : "open" / "wide" / "x"
      lying    : True なら倒れた姿勢
    """
    fur = pal["fur"]
    dark = pal["dark"]
    dy = pose.get("body_dy", 0)

    if pose.get("lying"):
        draw_lying(cell, pal, pose)
        return

    # 尻尾（体の左、後ろ側）
    if pose.get("tail", "up") == "up":
        cell.rect(6, 17 + dy, 7, 22 + dy, fur)
        cell.rect(5, 14 + dy, 6, 17 + dy, fur)
        cell.rect(6, 12 + dy, 7, 14 + dy, dark)
    else:
        cell.rect(6, 20 + dy, 7, 24 + dy, fur)
        cell.rect(4, 23 + dy, 6, 25 + dy, dark)

    # 足
    for (lx, length) in pose.get("legs", [(12, 6), (17, 6)]):
        cell.rect(lx, 24 + dy, lx + 2, 24 + dy + length, fur)
        cell.rect(lx, 24 + dy + length - 1, lx + 3, 24 + dy + length, dark)

    # 体
    cell.ellipse(15.5, 20.5 + dy, 5.5, 5.0, fur)
    cell.ellipse(16.5, 21.5 + dy, 3.2, 3.2, pal["muzzle"])

    # 腕
    arms = pose.get("arms", "down")
    if arms == "up":
        cell.rect(19, 12 + dy, 20, 18 + dy, fur)
        cell.rect(19, 11 + dy, 21, 12 + dy, dark)
    elif arms == "out":
        cell.rect(19, 18 + dy, 24, 19 + dy, fur)
        cell.rect(24, 18 + dy, 25, 19 + dy, dark)
    else:
        cell.rect(19, 18 + dy, 20, 23 + dy, fur)
        cell.rect(19, 23 + dy, 21, 24 + dy, dark)

    # 頭
    cell.ellipse(16.5, 9.5 + dy, 7.0, 6.5, fur)
    # 耳
    cell.triangle((10, 6 + dy), (12, 0 + dy), (15, 5 + dy), fur)
    cell.triangle((18, 5 + dy), (21, 0 + dy), (23, 6 + dy), fur)
    cell.triangle((11.5, 5 + dy), (12.5, 2 + dy), (14, 4.5 + dy), pal["ear"])
    cell.triangle((19, 4.5 + dy), (20.5, 2 + dy), (21.5, 5 + dy), pal["ear"])
    # 口まわり
    cell.ellipse(20.0, 11.5 + dy, 3.0, 2.2, pal["muzzle"])

    cell.outline(pal["line"])

    # 顔（ふち取りのあとに描く）
    draw_eyes(cell, pose.get("eyes", "open"), 18, 8 + dy)
    cell.put(22, 10 + dy, NOSE)
    cell.put(23, 10 + dy, NOSE)

def draw_eyes(cell, style, x, y):
    if style == "x":
        cell.put(x - 1, y - 1, EYE)
        cell.put(x + 1, y - 1, EYE)
        cell.put(x, y, EYE)
        cell.put(x - 1, y + 1, EYE)
        cell.put(x + 1, y + 1, EYE)
    elif style == "wide":
        cell.rect(x - 1, y - 1, x + 1, y + 1, EYE_WHITE)
        cell.put(x, y, EYE)
        cell.put(x + 1, y, EYE)
    else:
        cell.put(x, y - 1, EYE)
        cell.put(x, y, EYE)
        cell.put(x + 1, y, EYE)

def draw_lying(cell, pal, pose):
    """あお向けに倒れて、手足をばたつかせている姿"""
    fur = pal["fur"]
    dark = pal["dark"]
    kick = pose.get("kick", 0)

    # 尻尾
    cell.rect(2, 26, 7, 27, fur)
    cell.rect(1, 25, 2, 26, dark)
    # 体（横倒し）
    cell.ellipse(15.5, 25.0, 7.0, 4.5, fur)
    cell.ellipse(14.0, 24.0, 4.5, 2.5, pal["muzzle"])
    # 足（上へ突き出してばたつく）
    cell.rect(8, 15 + kick, 9, 21, fur)
    cell.rect(8, 14 + kick, 10, 15 + kick, dark)
    cell.rect(12, 17 - kick, 13, 21, fur)
    cell.rect(12, 16 - kick, 14, 17 - kick, dark)
    # 腕
    cell.rect(18, 17 + kick, 19, 21, fur)
    cell.rect(18, 16 + kick, 20, 17 + kick, dark)
    # 頭（右へ倒れている）
    cell.ellipse(24.5, 23.5, 6.5, 6.0, fur)
    cell.triangle((21, 19), (19, 14), (24, 17), fur)
    cell.triangle((27, 17), (30, 13), (30, 19), fur)
    cell.triangle((21.5, 18), (20.5, 15.5), (23, 17), pal["ear"])
    cell.triangle((27.5, 17), (29.5, 14.5), (29.5, 18.5), pal["ear"])
    cell.ellipse(25.5, 26.0, 3.0, 2.0, pal["muzzle"])

    cell.outline(pal["line"])

    draw_eyes(cell, "x", 24, 22)
    cell.put(26, 25, NOSE)

# ---------------------------------------------------------------------------
# コマの割り当て
# ---------------------------------------------------------------------------

POSES = [
    # 0 立ち
    {"legs": [(12, 6), (17, 6)], "arms": "down", "tail": "up", "eyes": "open"},
    # 1 歩き（左足が前）
    {"legs": [(10, 6), (18, 5)], "arms": "down", "tail": "up", "eyes": "open"},
    # 2 歩き（足がそろう。体が少し上がる）
    {"legs": [(13, 7), (16, 7)], "arms": "down", "tail": "up", "eyes": "open", "body_dy": -1},
    # 3 歩き（右足が前）
    {"legs": [(11, 5), (19, 6)], "arms": "down", "tail": "up", "eyes": "open"},
    # 4 ジャンプ（上がる。足を縮め、腕を上げる）
    {"legs": [(12, 3), (17, 3)], "arms": "up", "tail": "up", "eyes": "wide", "body_dy": -3},
    # 5 ジャンプ（落ちる。足を伸ばし、腕を広げる）
    {"legs": [(11, 7), (18, 7)], "arms": "out", "tail": "down", "eyes": "wide", "body_dy": -1},
    # 6 やられた（ジタバタ 1）
    {"lying": True, "kick": 0},
    # 7 やられた（ジタバタ 2）
    {"lying": True, "kick": 2},
]

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
    data += png_chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 6, 0, 0, 0))
    data += png_chunk(b"IDAT", zlib.compress(raw, 9))
    data += png_chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)
    return len(data)

def render():
    sheet = [[None] * WIDTH for _ in range(HEIGHT)]
    for row, pal in enumerate(PALETTES):
        for col, pose in enumerate(POSES):
            cell = Cell()
            draw_cat(cell, pal, pose)
            for y in range(CELL):
                for x in range(CELL):
                    sheet[row * CELL + y][col * CELL + x] = cell.px[y][x]

    rows = []
    for y in range(HEIGHT):
        line = bytearray()
        for x in range(WIDTH):
            color = sheet[y][x]
            if color is None:
                line += b"\x00\x00\x00\x00"
            else:
                line += bytes((color[0], color[1], color[2], 255))
        rows.append(bytes(line))
    return rows

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.normpath(
        os.path.join(here, "..", "web", "templates", "assets", "default-cat.png"))
    size = write_png(render(), out_path)
    print("出力:", out_path)
    print("  サイズ:", WIDTH, "x", HEIGHT, "/ RGBA /", CELL, "px x", COLUMNS * ROWS, "コマ")
    print("  ファイルサイズ:", size, "bytes")

if __name__ == "__main__":
    main()

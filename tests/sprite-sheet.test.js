// 同梱の猫のアニメパターン画像（default-cat.png）のテスト
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cellRect } from "../web/sprite.js";

const PATH = join(import.meta.dir, "..", "web", "templates", "assets", "default-cat.png");

/** PNG の IHDR から幅と高さを読む */
function pngSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), colorType: bytes[25] };
}

describe("同梱のアニメパターン画像", () => {
  test("PNG として置かれている", () => {
    const bytes = readFileSync(PATH);
    // シグネチャ
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test("32px のコマが横8列・縦2段（256×64）", () => {
    const { width, height } = pngSize(readFileSync(PATH));
    expect(width).toBe(256);
    expect(height).toBe(64);
    expect(cellRect(15, 32, width, height)).not.toBeNull();
    expect(cellRect(16, 32, width, height)).toBeNull();
  });

  test("背景透過を使えるよう RGBA で保存されている", () => {
    // colorType 6 = RGBA
    expect(pngSize(readFileSync(PATH)).colorType).toBe(6);
  });
});

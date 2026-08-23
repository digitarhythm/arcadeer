// アセット選択の対象タブ判定テスト
import { describe, expect, test } from "bun:test";
import { supportsAssetPicker } from "../web/asset-picker.js";

describe("アセット追加に対応するタブ", () => {
  test("画像・音声・3Dモデルは対応する", () => {
    expect(supportsAssetPicker("pane.tab.image")).toBe(true);
    expect(supportsAssetPicker("pane.tab.sound")).toBe(true);
    expect(supportsAssetPicker("pane.tab.model")).toBe(true);
  });

  test("オブジェクトタブは対応しない（クラスファイル作成のため）", () => {
    expect(supportsAssetPicker("pane.tab.object")).toBe(false);
  });

  test("未知のタブは対応しない", () => {
    expect(supportsAssetPicker("pane.tab.unknown")).toBe(false);
    expect(supportsAssetPicker("")).toBe(false);
  });
});

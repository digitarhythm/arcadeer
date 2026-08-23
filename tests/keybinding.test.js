// キーバインド設定のテスト
import { describe, expect, test } from "bun:test";
import {
  SUPPORTED_KEYBINDINGS,
  DEFAULT_KEYBINDING,
  normalizeKeybinding,
  resolveKeybinding,
  aceHandlerFor,
} from "../web/keybinding.js";

describe("キーバインドの定義", () => {
  test("通常とvimの2種類を提供する", () => {
    expect(SUPPORTED_KEYBINDINGS).toEqual(["default", "vim"]);
  });

  test("既定は通常キーバインド", () => {
    expect(DEFAULT_KEYBINDING).toBe("default");
  });
});

describe("キーバインド値の正規化", () => {
  test("対応する値をそのまま返す", () => {
    expect(normalizeKeybinding("default")).toBe("default");
    expect(normalizeKeybinding("vim")).toBe("vim");
  });

  test("大文字小文字と前後の空白を吸収する", () => {
    expect(normalizeKeybinding("VIM")).toBe("vim");
    expect(normalizeKeybinding("  Vim  ")).toBe("vim");
  });

  test("未対応・不正な値は null を返す", () => {
    expect(normalizeKeybinding("emacs")).toBeNull();
    expect(normalizeKeybinding("")).toBeNull();
    expect(normalizeKeybinding(null)).toBeNull();
    expect(normalizeKeybinding(undefined)).toBeNull();
    expect(normalizeKeybinding(123)).toBeNull();
  });
});

describe("使用するキーバインドの決定", () => {
  test("保存済みの値が対応していればそれを使う", () => {
    expect(resolveKeybinding("vim")).toBe("vim");
    expect(resolveKeybinding("default")).toBe("default");
  });

  test("未保存・不正な値なら既定へ戻す", () => {
    expect(resolveKeybinding(null)).toBe("default");
    expect(resolveKeybinding("emacs")).toBe("default");
  });
});

describe("Aceのキーボードハンドラ名", () => {
  test("vim はハンドラ名を返す", () => {
    expect(aceHandlerFor("vim")).toBe("ace/keyboard/vim");
  });

  test("通常キーバインドは null（ハンドラ解除）を返す", () => {
    expect(aceHandlerFor("default")).toBeNull();
  });

  test("未対応の値も null を返す", () => {
    expect(aceHandlerFor("emacs")).toBeNull();
  });
});

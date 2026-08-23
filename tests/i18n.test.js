// 多言語対応（i18n）のテスト
// 設計は docs/i18n.md を参照
import { describe, expect, test, beforeEach } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SUPPORTED_LANGS,
  FALLBACK_LANG,
  normalizeLang,
  resolveLang,
  setCatalog,
  setLanguage,
  t,
} from "../web/i18n.js";

const LOCALES_DIR = join(import.meta.dir, "..", "web", "locales");
const REFERENCE_LANG = "ja";

/** ロケールJSONを読み込む */
function readLocale(tag) {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${tag}.json`), "utf-8"));
}

/** 文字列中の {プレースホルダ} 名を集める */
function placeholders(text) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe("対応言語の定義", () => {
  test("11言語が定義されている", () => {
    expect(SUPPORTED_LANGS).toEqual([
      "ja",
      "en",
      "zh-Hans",
      "zh-Hant",
      "ko",
      "es",
      "fr",
      "de",
      "it",
      "nl",
      "pt",
    ]);
  });

  test("フォールバックは英語", () => {
    expect(FALLBACK_LANG).toBe("en");
  });
});

describe("言語タグの正規化", () => {
  test("地域付きタグを対応タグへ寄せる", () => {
    expect(normalizeLang("ja")).toBe("ja");
    expect(normalizeLang("ja-JP")).toBe("ja");
    expect(normalizeLang("en-US")).toBe("en");
    expect(normalizeLang("en-GB")).toBe("en");
    expect(normalizeLang("ko-KR")).toBe("ko");
    expect(normalizeLang("pt-BR")).toBe("pt");
    expect(normalizeLang("pt-PT")).toBe("pt");
  });

  test("中国語は文字体系で振り分ける", () => {
    expect(normalizeLang("zh-Hans")).toBe("zh-Hans");
    expect(normalizeLang("zh-CN")).toBe("zh-Hans");
    expect(normalizeLang("zh-SG")).toBe("zh-Hans");
    expect(normalizeLang("zh-Hans-CN")).toBe("zh-Hans");
    expect(normalizeLang("zh-Hant")).toBe("zh-Hant");
    expect(normalizeLang("zh-TW")).toBe("zh-Hant");
    expect(normalizeLang("zh-HK")).toBe("zh-Hant");
    expect(normalizeLang("zh-MO")).toBe("zh-Hant");
  });

  test("文字体系が不明な中国語は簡体字にする", () => {
    expect(normalizeLang("zh")).toBe("zh-Hans");
  });

  test("大文字小文字を区別しない", () => {
    expect(normalizeLang("JA-jp")).toBe("ja");
    expect(normalizeLang("ZH-hant")).toBe("zh-Hant");
  });

  test("未対応・不正な値は null を返す", () => {
    expect(normalizeLang("ru")).toBeNull();
    expect(normalizeLang("")).toBeNull();
    expect(normalizeLang(null)).toBeNull();
    expect(normalizeLang(undefined)).toBeNull();
  });
});

describe("使用言語の決定", () => {
  test("保存済みの言語を最優先する", () => {
    expect(resolveLang("fr", ["ja-JP", "en-US"])).toBe("fr");
  });

  test("保存値が未対応なら navigator の順で選ぶ", () => {
    expect(resolveLang("xx", ["ru", "de-AT", "en"])).toBe("de");
  });

  test("保存値が無ければ navigator の先頭から順に判定する", () => {
    expect(resolveLang(null, ["ru-RU", "zh-TW"])).toBe("zh-Hant");
  });

  test("どれも対応していなければフォールバックする", () => {
    expect(resolveLang(null, ["ru-RU", "th-TH"])).toBe("en");
    expect(resolveLang(null, [])).toBe("en");
  });
});

describe("翻訳関数 t()", () => {
  beforeEach(() => {
    setCatalog("en", { greet: "Hello, {name}!", only_en: "English only" });
    setCatalog("ja", { greet: "こんにちは、{name}さん！" });
    setLanguage("ja");
  });

  test("選択中の言語で翻訳する", () => {
    expect(t("greet", { name: "太郎" })).toBe("こんにちは、太郎さん！");
  });

  test("選択中の言語に無いキーはフォールバック言語で補う", () => {
    expect(t("only_en")).toBe("English only");
  });

  test("未定義キーはキー文字列をそのまま返す", () => {
    expect(t("missing.key")).toBe("missing.key");
  });

  test("値が渡されなかったプレースホルダは残す", () => {
    expect(t("greet")).toBe("こんにちは、{name}さん！");
  });

  test("同じプレースホルダを複数回展開できる", () => {
    setCatalog("ja", { twice: "{v} と {v}" });
    setLanguage("ja");
    expect(t("twice", { v: "A" })).toBe("A と A");
  });
});

describe("ロケールファイルの整合性", () => {
  test("対応言語すべてのロケールファイルが存在する", () => {
    const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
    const tags = files.map((f) => f.replace(/\.json$/, "")).sort();
    expect(tags).toEqual([...SUPPORTED_LANGS].sort());
  });

  test("全ロケールのキー集合が日本語版と完全に一致する", () => {
    const reference = Object.keys(readLocale(REFERENCE_LANG)).sort();
    for (const tag of SUPPORTED_LANGS) {
      expect({ tag, keys: Object.keys(readLocale(tag)).sort() }).toEqual({
        tag,
        keys: reference,
      });
    }
  });

  test("全ロケールの値が空でない文字列である", () => {
    for (const tag of SUPPORTED_LANGS) {
      const dict = readLocale(tag);
      for (const [key, value] of Object.entries(dict)) {
        expect({ tag, key, ok: typeof value === "string" && value.trim() !== "" }).toEqual({
          tag,
          key,
          ok: true,
        });
      }
    }
  });

  test("各キーの補間プレースホルダが全言語で一致する", () => {
    const reference = readLocale(REFERENCE_LANG);
    for (const tag of SUPPORTED_LANGS) {
      const dict = readLocale(tag);
      for (const [key, value] of Object.entries(reference)) {
        expect({ tag, key, ph: placeholders(dict[key]) }).toEqual({
          tag,
          key,
          ph: placeholders(value),
        });
      }
    }
  });

  test("日本語版に左ペインのタブ見出しが揃っている", () => {
    const dict = readLocale(REFERENCE_LANG);
    expect(dict["pane.tab.object"]).toBe("オブジェクト");
    expect(dict["pane.tab.image"]).toBe("画像");
    expect(dict["pane.tab.sound"]).toBe("音声");
    expect(dict["pane.tab.model"]).toBe("3Dモデル");
  });
});

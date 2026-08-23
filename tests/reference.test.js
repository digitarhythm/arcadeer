// リファレンスの構成と各言語の内容がそろっているかのテスト
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { SECTIONS, referenceKeys } from "../web/reference/structure.js";
import { SUPPORTED_LANGS } from "../web/i18n.js";

const DIR = join(import.meta.dir, "..", "web", "reference");
const load = (lang) => JSON.parse(readFileSync(join(DIR, `${lang}.json`), "utf8"));

describe("構成", () => {
  test("4つの章がある", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["start", "basics", "api", "ide"]);
  });

  test("どの章にも中身がある", () => {
    for (const section of SECTIONS) {
      expect(section.blocks.length).toBeGreaterThan(0);
    }
  });

  test("ブロックの種類は決められたものだけ", () => {
    const allowed = ["heading", "text", "code", "table"];
    for (const section of SECTIONS) {
      for (const block of section.blocks) {
        expect(allowed).toContain(block.type);
      }
    }
  });

  test("表は見出しと同じ列数になっている", () => {
    for (const section of SECTIONS) {
      for (const block of section.blocks) {
        if (block.type !== "table") continue;
        for (const row of block.rows) {
          expect(row.length).toBe(block.head.length);
        }
      }
    }
  });

  test("コードは翻訳しない（キーを持たない）", () => {
    for (const section of SECTIONS) {
      for (const block of section.blocks) {
        if (block.type !== "code") continue;
        expect(typeof block.code).toBe("string");
        expect(block.k).toBeUndefined();
      }
    }
  });

  test("翻訳キーに重複が無い", () => {
    const keys = referenceKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("各言語の内容", () => {
  const keys = referenceKeys();

  test("対応言語ぶんのファイルがある", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toEqual(SUPPORTED_LANGS.map((l) => `${l}.json`).sort());
  });

  for (const lang of SUPPORTED_LANGS) {
    test(`${lang}: 構成が使うキーがすべてある`, () => {
      const data = load(lang);
      const missing = keys.filter((k) => !(k in data));
      expect(missing).toEqual([]);
    });

    test(`${lang}: 使っていないキーが無い`, () => {
      const extra = Object.keys(load(lang)).filter((k) => !keys.includes(k));
      expect(extra).toEqual([]);
    });

    test(`${lang}: 空の文が無い`, () => {
      const data = load(lang);
      const empty = keys.filter((k) => typeof data[k] !== "string" || data[k].trim() === "");
      expect(empty).toEqual([]);
    });
  }

  test("同じ内容の使い回しになっていない（日本語と英語が別物である）", () => {
    const ja = load("ja");
    const en = load("en");
    const same = keys.filter((k) => ja[k] === en[k]);
    // 記号だけの項目は一致しうるが、大半が一致するのは訳し漏れ
    expect(same.length).toBeLessThan(keys.length * 0.2);
  });
});

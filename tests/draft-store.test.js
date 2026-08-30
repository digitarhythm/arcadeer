// 編集中の下書き（IndexedDB）の判断ロジックのテスト
import { describe, expect, test } from "bun:test";

import { draftKey, decideOpen, projectOf } from "../web/draft-store.js";

describe("下書きの鍵", () => {
  test("プロジェクトとファイル名で作る", () => {
    expect(draftKey("abc-123", "myship.coffee")).toBe("abc-123/myship.coffee");
  });

  test("プロジェクトが違えば別の下書きになる", () => {
    expect(draftKey("A", "gameMain.coffee")).not.toBe(draftKey("B", "gameMain.coffee"));
  });

  test("プロジェクトが分からない場合でも鍵は作れる", () => {
    expect(draftKey("", "myship.coffee")).toBe("/myship.coffee");
    expect(draftKey(null, "myship.coffee")).toBe("/myship.coffee");
  });

  test("鍵からプロジェクトを取り出せる", () => {
    expect(projectOf("abc-123/myship.coffee")).toBe("abc-123");
    // ファイル名に区切りが含まれていても、先頭までを見る
    expect(projectOf("abc-123/code/myship.coffee")).toBe("abc-123");
  });
});

describe("開く時の判断", () => {
  const draft = (content, savedAt) => ({ content, savedAt });

  test("下書きが無ければ、ファイルを開く", () => {
    expect(decideOpen(null, "A", 100)).toBe("file");
    expect(decideOpen(undefined, "A", 100)).toBe("file");
  });

  test("下書きとファイルが同じなら、ファイルを開く", () => {
    // 保存済みで中身が一致しているので、下書きは用済み
    expect(decideOpen(draft("A", 50), "A", 100)).toBe("file");
  });

  test("下書きのほうが新しければ、そのまま復元する", () => {
    expect(decideOpen(draft("B", 200), "A", 100)).toBe("draft");
  });

  test("同じ時刻なら復元する", () => {
    // 保存した直後は同じ時刻になりうる。編集の続きを優先する
    expect(decideOpen(draft("B", 100), "A", 100)).toBe("draft");
  });

  test("ファイルのほうが新しければ、尋ねる", () => {
    // 外のエディタで書き換えられた可能性がある
    expect(decideOpen(draft("B", 100), "C", 200)).toBe("ask");
  });

  test("ファイルの時刻が分からなければ、復元する", () => {
    // 時刻が取れない環境でも、編集内容を失わないほうを選ぶ
    expect(decideOpen(draft("B", 100), "A", null)).toBe("draft");
    expect(decideOpen(draft("B", 100), "A", undefined)).toBe("draft");
  });

  test("下書きの時刻が分からなければ、尋ねる", () => {
    // 判断できないので、勝手に上書きしない
    expect(decideOpen({ content: "B" }, "A", 100)).toBe("ask");
  });

  test("中身が同じなら、時刻が違ってもファイルを開く", () => {
    expect(decideOpen(draft("A", 100), "A", 200)).toBe("file");
  });
});

// 編集中の下書きの保管（仕様書4.11節）
//
// エディタの内容は、**入力が1秒止まるたび**にここへ書く。
// 別のソースへ切り替えても、ブラウザを閉じても、編集の途中経過が失われない。
//
// ファイルへ書き込むのは `⌘S` を押した時だけで、下書きはあくまで控えである。
//
// 判断の部分は画面にもIndexedDBにも依存しないため単体テストできる。

import { STORE_DRAFTS, get, put, del, entries } from "./idb.js";

/** 下書きの鍵（プロジェクトが違えば別物として扱う） */
export function draftKey(projectId, fileName) {
  return `${projectId ?? ""}/${fileName ?? ""}`;
}

/** 鍵からプロジェクトを取り出す */
export function projectOf(key) {
  return String(key ?? "").split("/")[0];
}

/**
 * 開く時に、下書きとファイルのどちらを使うかを決める
 *
 * | 状況 | 返り値 |
 * | --- | --- |
 * | 下書きが無い／中身が同じ | `"file"` |
 * | 下書きのほうが新しい | `"draft"` |
 * | **ファイルのほうが新しい** | `"ask"`（外で書き換えられた恐れがある） |
 *
 * 時刻が取れない場合は、**編集内容を失わないほう**へ倒す。
 * ただし下書きの時刻が分からない場合は、勝手に上書きせず尋ねる。
 */
export function decideOpen(draft, fileContent, fileModified) {
  if (!draft || typeof draft.content !== "string") return "file";
  // 中身が同じなら、下書きは用済み
  if (draft.content === fileContent) return "file";

  const savedAt = draft.savedAt;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return "ask";
  if (typeof fileModified !== "number" || !Number.isFinite(fileModified)) return "draft";

  // 保存した直後は同じ時刻になりうる。編集の続きを優先する
  return savedAt >= fileModified ? "draft" : "ask";
}

/** 下書きを書く */
export async function saveDraft(key, content, now = Date.now()) {
  try {
    await put(STORE_DRAFTS, key, { content, savedAt: now });
    return true;
  } catch {
    // 書けない環境（プライベートモード等）でも、編集そのものは続けられる
    return false;
  }
}

/** 下書きを読む（無ければ null） */
export async function loadDraft(key) {
  try {
    return await get(STORE_DRAFTS, key);
  } catch {
    return null;
  }
}

/** 下書きを消す */
export async function clearDraft(key) {
  try {
    await del(STORE_DRAFTS, key);
  } catch {
    // 消せなくても、次の保存で上書きされる
  }
}

/**
 * そのプロジェクトの下書きを全部読む
 *
 * ゲームを実行する前に、保存されていないものをまとめて書き出すために使う。
 */
export async function draftsOf(projectId) {
  try {
    const all = await entries(STORE_DRAFTS);
    return all
      .filter(({ key }) => projectOf(key) === String(projectId ?? ""))
      .map(({ key, value }) => ({
        key,
        fileName: String(key).slice(projectOf(key).length + 1),
        content: value?.content ?? "",
      }))
      .filter((d) => d.fileName !== "");
  } catch {
    return [];
  }
}

if (typeof window !== "undefined") {
  // WASM(Rust)から、実行前の書き出しに使う
  window.arcadeerDraftsOf = draftsOf;
  window.arcadeerClearDraft = clearDraft;
}

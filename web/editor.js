// コードエディタモジュール（Ace Editor）
// 左ペインのオブジェクトをクリックした時に、右ペイン（メイン部）で編集できるようにする。
// WASM(Rust)からは window.arcadeerOpenEditor / window.arcadeerEditorSaved 経由で呼び出す。

import { t } from "./i18n.js";
import { getKeybinding, aceHandlerFor } from "./keybinding.js";
import { showConfirm } from "./message-dialog.js";
import { draftKey, decideOpen, saveDraft, loadDraft, clearDraft } from "./draft-store.js";

const ACE_VERSION = "1.43.2";
const ACE_BASE = `https://cdnjs.cloudflare.com/ajax/libs/ace/${ACE_VERSION}`;

let acePromise = null;
let editor = null;
/** 編集中のファイル名（保存時にWASMへ渡す） */
let currentFile = null;
/** 保存済みの内容。未保存かどうかの判定に使う */
let savedContent = "";
/** いま編集しているファイルの下書きの鍵 */
let currentKey = null;

/**
 * 下書きを書くまでの待ち時間（ミリ秒）
 *
 * 打っている最中に毎回書くと無駄が多い。**入力が止まってから**書く。
 */
const DRAFT_DELAY = 1000;
let draftTimer = null;

/** 入力が止まったら下書きを残す */
function scheduleDraft() {
  if (!currentKey) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (!editor || !currentKey) return;
    const 内容 = editor.getValue();
    // ファイルと同じに戻っていれば、下書きは要らない
    if (内容 === savedContent) clearDraft(currentKey);
    else saveDraft(currentKey, 内容);
  }, DRAFT_DELAY);
}

/** Ace本体をCDNから一度だけ読み込む */
function loadAce() {
  if (acePromise) return acePromise;
  acePromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${ACE_BASE}/ace.js`;
    script.onload = () => {
      window.ace.config.set("basePath", ACE_BASE);
      resolve(window.ace);
    };
    script.onerror = () => reject(new Error("failed to load Ace Editor"));
    document.head.appendChild(script);
  });
  return acePromise;
}

/** 現在の設定に応じてキーバインドをエディタへ適用する */
function applyKeybinding() {
  if (!editor) return;
  const handler = aceHandlerFor(getKeybinding());
  editor.setKeyboardHandler(handler);
  if (handler) enableVimWrite();
}

/** vim の :w / :write で保存できるようにする */
function enableVimWrite() {
  try {
    const vim = window.ace?.require("ace/keyboard/vim");
    const Vim = vim?.CodeMirror?.Vim ?? vim?.Vim;
    if (!Vim?.defineEx) return;
    Vim.defineEx("write", "w", requestSave);
  } catch {
    // vim拡張の内部APIは版によって異なるため、失敗しても ⌘S / Ctrl+S で保存できる
  }
}

/** 未保存マークの表示を更新する */
function updateDirtyMark() {
  const mark = document.getElementById("editor-dirty");
  if (!mark) return;
  const dirty = editor !== null && editor.getValue() !== savedContent;
  mark.textContent = dirty ? t("editor.unsavedMark") : "";
}

/**
 * 保存を要求する（実際の書き込みはWASM側が行う）
 *
 * **先に下書きを確定させてから**要求する。書き込みに失敗しても、
 * 編集内容が残るようにするため。
 */
function requestSave() {
  if (!editor || !currentFile) return;
  clearTimeout(draftTimer);
  const 内容 = editor.getValue();
  if (currentKey) saveDraft(currentKey, 内容);
  window.dispatchEvent(
    new CustomEvent("arcadeer:save", {
      detail: { fileName: currentFile, content: 内容 },
    }),
  );
}

/**
 * 指定ファイルをメイン部で開く
 *
 * 下書き（4.11節）が残っていれば、そちらを復元する。
 * ただし**ファイルのほうが新しい**場合は、外で書き換えられた恐れがあるため尋ねる。
 *
 * @param {string} fileName 表示・保存に使うファイル名
 * @param {string} content  ファイルの内容
 * @param {string} projectId プロジェクトの識別子（下書きの鍵に使う）
 * @param {number} modified ファイルの最終更新時刻（ミリ秒）
 */
export async function openEditor(fileName, content, projectId, modified) {
  const main = document.getElementById("ide-content");
  if (!main) return;

  // 開く前に、直前まで編集していたぶんを確定させる
  clearTimeout(draftTimer);
  if (currentKey && editor && editor.getValue() !== savedContent) {
    await saveDraft(currentKey, editor.getValue());
  }

  const key = draftKey(projectId, fileName);
  const draft = await loadDraft(key);
  let 開く内容 = content;
  const 判断 = decideOpen(draft, content, modified);
  if (判断 === "draft") {
    開く内容 = draft.content;
  } else if (判断 === "ask") {
    // OK なら読み込み直す。やめる なら編集の続きを守る
    if (await showConfirm(t("editor.fileChanged"))) await clearDraft(key);
    else 開く内容 = draft.content;
  } else {
    await clearDraft(key);
  }

  let ace;
  try {
    ace = await loadAce();
  } catch {
    main.innerHTML = "";
    const error = document.createElement("p");
    error.className = "pane-empty";
    error.textContent = t("editor.loadFailed");
    main.appendChild(error);
    window.arcadeerFadeInElement?.(main);
    return;
  }

  // 既存表示をフェードアウトしてから差し替える
  if (main.childElementCount > 0) {
    await window.arcadeerFadeOutElement?.(main);
  }
  main.innerHTML = `
    <div class="editor-pane">
      <div class="editor-header">
        <span class="editor-filename" id="editor-filename"></span>
        <span class="editor-dirty" id="editor-dirty"></span>
        <span class="editor-hint" id="editor-hint"></span>
      </div>
      <div class="editor-body" id="editor-body"></div>
    </div>
  `;
  document.getElementById("editor-filename").textContent = fileName;
  document.getElementById("editor-hint").textContent = t("editor.saveHint");

  editor = ace.edit("editor-body");
  editor.setTheme("ace/theme/tomorrow_night");
  editor.session.setMode("ace/mode/coffee");
  editor.session.setTabSize(2);
  editor.session.setUseSoftTabs(true);
  editor.setOptions({ fontSize: "13px", showPrintMargin: false });
  editor.setValue(開く内容, -1);

  applyKeybinding();

  currentFile = fileName;
  currentKey = key;
  // 未保存かどうかは**ファイルの内容**と比べて決める
  savedContent = content;
  editor.session.on("change", () => {
    updateDirtyMark();
    scheduleDraft();
  });
  updateDirtyMark();

  // Cmd+S / Ctrl+S で保存する
  editor.commands.addCommand({
    name: "arcadeerSave",
    bindKey: { win: "Ctrl-S", mac: "Command-S" },
    exec: requestSave,
  });

  window.arcadeerFadeInElement?.(main);
  editor.focus();
}

/**
 * エディタへフォーカスを移す
 *
 * ファイルを開いていない場合は何もしない。
 * @returns 移せたかどうか
 */
export function focusEditor() {
  if (!editor) return false;
  editor.focus();
  return true;
}

/** 保存が完了したことを受け取り、未保存マークを消す */
export function markSaved(content) {
  savedContent = content;
  // ファイルへ書けたので、下書きは用済み
  if (currentKey && editor?.getValue() === content) clearDraft(currentKey);
  updateDirtyMark();
}

/** 表示言語が変わった時に、エディタ周りの文言を差し替える */
function applyTexts() {
  const hint = document.getElementById("editor-hint");
  if (hint) hint.textContent = t("editor.saveHint");
  updateDirtyMark();
}

if (typeof window !== "undefined") {
  window.arcadeerOpenEditor = openEditor;
  window.arcadeerEditorSaved = markSaved;
  window.arcadeerFocusEditor = focusEditor;
  window.addEventListener("arcadeer:languagechange", applyTexts);
  window.addEventListener("arcadeer:keybindingchange", applyKeybinding);
  // ブラウザ標準の保存ダイアログを抑止し、エディタの保存に割り当てる
  // ゲーム表示エリアにフォーカスがある間は、そちらの操作を優先する
  window.addEventListener("keydown", (e) => {
    if (document.activeElement?.id === "game-canvas") return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && editor) {
      e.preventDefault();
      requestSave();
    }
  });
}

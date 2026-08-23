// コードエディタモジュール（Ace Editor）
// 左ペインのオブジェクトをクリックした時に、右ペイン（メイン部）で編集できるようにする。
// WASM(Rust)からは window.arcadeerOpenEditor / window.arcadeerEditorSaved 経由で呼び出す。

import { t } from "./i18n.js";
import { getKeybinding, aceHandlerFor } from "./keybinding.js";

const ACE_VERSION = "1.43.2";
const ACE_BASE = `https://cdnjs.cloudflare.com/ajax/libs/ace/${ACE_VERSION}`;

let acePromise = null;
let editor = null;
/** 編集中のファイル名（保存時にWASMへ渡す） */
let currentFile = null;
/** 保存済みの内容。未保存かどうかの判定に使う */
let savedContent = "";

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

/** 保存を要求する（実際の書き込みはWASM側が行う） */
function requestSave() {
  if (!editor || !currentFile) return;
  window.dispatchEvent(
    new CustomEvent("arcadeer:save", {
      detail: { fileName: currentFile, content: editor.getValue() },
    }),
  );
}

/**
 * 指定ファイルをメイン部で開く
 * @param {string} fileName 表示・保存に使うファイル名
 * @param {string} content  初期内容
 */
export async function openEditor(fileName, content) {
  const main = document.getElementById("ide-content");
  if (!main) return;

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
  editor.setValue(content, -1);

  applyKeybinding();

  currentFile = fileName;
  savedContent = content;
  editor.session.on("change", updateDirtyMark);
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

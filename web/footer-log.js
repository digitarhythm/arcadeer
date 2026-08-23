// フッターの開閉（仕様書4.6節）
//
// 通常は1行だけを表示し、クリックすると10行ぶんへ広がって過去ログを見られる。
// 高さの切り替えはCSS（body の footer-expanded クラス）が行う。

import { t } from "./i18n.js";
import { renderAllLogs, clearLogView, clearLogs } from "./console-log.js";

const EXPANDED_CLASS = "footer-expanded";

/** 開いているか */
export function isExpanded() {
  return document.body.classList.contains(EXPANDED_CLASS);
}

/** 開閉を切り替える */
export function toggleFooterLog() {
  const open = document.body.classList.toggle(EXPANDED_CLASS);
  applyState(open);
  return open;
}

/** 開閉に応じて、目印と読み上げの状態を合わせる */
function applyState(open) {
  const bar = document.getElementById("footer-bar");
  if (bar) {
    bar.setAttribute("aria-expanded", open ? "true" : "false");
    const label = t(open ? "footer.hideLog" : "footer.showLog");
    bar.setAttribute("aria-label", label);
    // フッターは独自ツールチップの対象外のため、標準の title を使う
    bar.setAttribute("title", label);
  }
  const caret = document.getElementById("footer-caret");
  if (caret) caret.textContent = open ? "▼" : "▲";

  // クリアボタンは、履歴を見ている間だけ出す
  const clear = document.getElementById("btn-clear-log");
  if (clear) {
    clear.hidden = !open;
    const label = t("footer.clearLog");
    clear.setAttribute("aria-label", label);
    clear.setAttribute("title", label);
  }

  // 一覧は開いている間だけ持つ。閉じている間にDOMを増やさないことで、
  // echo() を毎フレーム呼んでも負担にならないようにする（4.6節）
  if (open) {
    renderAllLogs();
  } else {
    clearLogView();
  }
}

/** フッターのクリック操作を組み立てる */
export function initFooterLog() {
  const bar = document.getElementById("footer-bar");
  if (!bar) return;

  bar.addEventListener("click", toggleFooterLog);

  // クリアボタンはバーの中にあるため、押しても開閉させない
  document.getElementById("btn-clear-log")?.addEventListener("click", (e) => {
    e.stopPropagation();
    clearLogs();
  });
  // キーボードでも開閉できるようにする
  bar.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggleFooterLog();
  });

  applyState(false);
  // WASM(Rust)のショートカット（Alt+Shift+N）から呼べるようにする
  window.arcadeerToggleFooterLog = toggleFooterLog;
  // 表示言語が変わったらツールチップも追従させる
  window.addEventListener("arcadeer:languagechange", () => applyState(isExpanded()));
}

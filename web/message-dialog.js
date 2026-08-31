import { t } from "./i18n.js";

// メッセージダイアログモジュール
// 種別ごとに見た目を変えてモーダル表示する。Tailwind(Play CDN)でスタイリングする。
// WASM(Rust)からは window.arcadeerShowMessage(message, kind, title) で呼び出される。

import { fadeInDialog, fadeOutDialog } from "./fade.js";

const KINDS = {
  info: { labelKey: "message.info", accent: "text-sky-300", ring: "ring-sky-500/50", icon: "ℹ" },
  success: { labelKey: "message.success", accent: "text-emerald-300", ring: "ring-emerald-500/50", icon: "✓" },
  warning: { labelKey: "message.warning", accent: "text-amber-300", ring: "ring-amber-500/50", icon: "!" },
  error: { labelKey: "message.error", accent: "text-rose-300", ring: "ring-rose-500/50", icon: "✕" },
};

let dialogEl = null;
let okBtnEl = null;
let iconEl = null;
let titleEl = null;
let bodyEl = null;
let cancelBtnEl = null;
/** 問い合わせ中の返事先（`showConfirm` の Promise） */
let answer = null;

// ダイアログDOMを一度だけ生成し、以後は使い回す
function build() {
  const dialog = document.createElement("dialog");
  dialog.id = "arcadeer-message-dialog";
  dialog.className =
    "m-auto w-[min(92vw,420px)] rounded-xl border border-slate-700 bg-slate-800 p-0 " +
    "text-slate-100 shadow-2xl backdrop:bg-black/50";
  dialog.innerHTML = `
    <div class="flex flex-col gap-4 p-6">
      <div class="flex items-center gap-3">
        <span data-role="icon"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700 text-lg font-bold ring-2"></span>
        <h2 data-role="title" class="text-base font-semibold"></h2>
      </div>
      <p data-role="body" class="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300"></p>
      <div class="flex justify-end gap-2">
        <button type="button" data-role="cancel" hidden
          class="cursor-pointer rounded-md border border-slate-600 bg-transparent px-5 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400">
        </button>
        <button type="button" data-role="ok"
          class="cursor-pointer rounded-md border-0 bg-sky-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400">
          OK
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  iconEl = dialog.querySelector('[data-role="icon"]');
  titleEl = dialog.querySelector('[data-role="title"]');
  bodyEl = dialog.querySelector('[data-role="body"]');
  const okBtn = dialog.querySelector('[data-role="ok"]');
  okBtn.addEventListener("click", () => settle(true));
  okBtnEl = okBtn;

  cancelBtnEl = dialog.querySelector('[data-role="cancel"]');
  cancelBtnEl.addEventListener("click", () => settle(false));
  // ESCや画面外クリックで閉じた場合も「やめる」として扱う
  dialog.addEventListener("close", () => settle(false));

  dialogEl = dialog;
}

/**
 * 開く直前にフォーカスがあった場所
 *
 * 閉じた時にそこへ戻すため。編集中にエラーが出た場合、
 * 閉じたあとそのまま書き続けられるようにする。
 */
let focusBefore = null;

/** 開く直前のフォーカスを控える */
function rememberFocus() {
  const active = document.activeElement;
  // ダイアログの中や body 自身は戻り先にしない
  focusBefore = active && active !== document.body && !dialogEl?.contains(active) ? active : null;
}

/**
 * 閉じたあと、元いた場所へフォーカスを戻す
 *
 * 元の要素が画面から消えている場合（一覧の作り直しなど）は、
 * エディタが出ていればそちらへ戻す。
 */
function restoreFocus() {
  if (focusBefore?.isConnected) {
    focusBefore.focus({ preventScroll: true });
  } else if (document.querySelector(".ace_editor")) {
    window.arcadeerFocusEditor?.();
  }
  focusBefore = null;
}

/** 開いている問い合わせに答えて閉じる */
function settle(value) {
  const reply = answer;
  answer = null;
  if (dialogEl?.open) fadeOutDialog(dialogEl);
  restoreFocus();
  reply?.(value);
}

// メッセージを表示する
//   message: 本文
//   kind   : "info" | "success" | "warning" | "error"（既定: info）
//   title  : 見出し（省略時は種別の既定ラベル）
export function showMessage(message, kind = "info", title) {
  if (!dialogEl) build();
  const k = KINDS[kind] ?? KINDS.info;

  iconEl.className =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700 " +
    "text-lg font-bold ring-2 " + k.ring + " " + k.accent;
  iconEl.textContent = k.icon;

  titleEl.className = "text-base font-semibold " + k.accent;
  titleEl.textContent = title ?? t(k.labelKey);
  okBtnEl.textContent = t("message.close");

  bodyEl.textContent = message ?? "";
  cancelBtnEl.hidden = true;

  if (!dialogEl.open) {
    rememberFocus();
    fadeInDialog(dialogEl);
  }
}

/**
 * はい／いいえを尋ねる
 *
 * ```js
 * if (await showConfirm(t("editor.fileChanged"))) { ... }
 * ```
 *
 * ESC や画面外クリックで閉じた場合は「やめる」（false）として返す。
 *
 * @returns OK を押したら true
 */
export function showConfirm(message, kind = "warning", title) {
  if (!dialogEl) build();
  const k = KINDS[kind] ?? KINDS.warning;

  iconEl.className =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700 " +
    "text-lg font-bold ring-2 " + k.ring + " " + k.accent;
  iconEl.textContent = k.icon;

  titleEl.className = "text-base font-semibold " + k.accent;
  titleEl.textContent = title ?? t(k.labelKey);
  okBtnEl.textContent = t("message.ok");
  cancelBtnEl.textContent = t("message.cancel");
  cancelBtnEl.hidden = false;
  bodyEl.textContent = message ?? "";

  return new Promise((resolve) => {
    // 前の問い合わせが残っていれば「やめる」で片付ける
    answer?.(false);
    answer = resolve;
    if (!dialogEl.open) {
      rememberFocus();
      fadeInDialog(dialogEl);
    }
  });
}

// WASMから呼べるようグローバルへ公開する
window.arcadeerShowMessage = showMessage;
window.arcadeerShowConfirm = showConfirm;

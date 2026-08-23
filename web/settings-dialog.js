// システム設定ダイアログモジュール
// フッター右端の設定ボタンから開き、表示言語を切り替える。
// 文言は i18n.js（web/locales/*.json）から取得する。

import { t, getLanguage, changeLanguage, SUPPORTED_LANGS, LANG_NAMES } from "./i18n.js";
import { SUPPORTED_KEYBINDINGS, getKeybinding, setKeybinding } from "./keybinding.js";

let dialog = null;
let titleEl = null;
let languageLabelEl = null;
let selectEl = null;
let keybindingLabelEl = null;
let keybindingSelectEl = null;
let closeBtn = null;

/** ダイアログDOMを一度だけ生成し、以後は使い回す */
function ensureDialog() {
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "arcadeer-settings-dialog";
  dialog.className = "fade-dialog dialog-new-project";
  dialog.innerHTML = `
    <form method="dialog" class="dialog-form">
      <h2 data-settings-title></h2>
      <label for="settings-language" data-settings-language-label></label>
      <select id="settings-language" class="dialog-select"></select>
      <label for="settings-keybinding" data-settings-keybinding-label></label>
      <select id="settings-keybinding" class="dialog-select"></select>
      <div class="dialog-buttons">
        <button type="button" class="dialog-btn dialog-btn-primary" data-settings-close></button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);

  titleEl = dialog.querySelector("[data-settings-title]");
  languageLabelEl = dialog.querySelector("[data-settings-language-label]");
  selectEl = dialog.querySelector("#settings-language");
  keybindingLabelEl = dialog.querySelector("[data-settings-keybinding-label]");
  keybindingSelectEl = dialog.querySelector("#settings-keybinding");
  closeBtn = dialog.querySelector("[data-settings-close]");

  for (const tag of SUPPORTED_LANGS) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = LANG_NAMES[tag];
    selectEl.appendChild(option);
  }

  for (const keybinding of SUPPORTED_KEYBINDINGS) {
    const option = document.createElement("option");
    option.value = keybinding;
    keybindingSelectEl.appendChild(option);
  }

  // 選択した時点で即座に反映する（確定ボタンは設けない）
  selectEl.addEventListener("change", async () => {
    await changeLanguage(selectEl.value);
    applyTexts();
  });

  keybindingSelectEl.addEventListener("change", () => {
    setKeybinding(keybindingSelectEl.value);
  });

  closeBtn.addEventListener("click", () => window.arcadeerFadeOutDialog(dialog));

  return dialog;
}

/** ダイアログ内の文言を現在の言語で入れ直す */
function applyTexts() {
  titleEl.textContent = t("settings.title");
  languageLabelEl.textContent = t("settings.language");
  keybindingLabelEl.textContent = t("settings.keybinding");
  for (const option of keybindingSelectEl.options) {
    option.textContent = t(`keybinding.${option.value}`);
  }
  closeBtn.textContent = t("settings.close");
}

/** システム設定ダイアログを開く */
export function showSettings() {
  ensureDialog();
  selectEl.value = getLanguage();
  keybindingSelectEl.value = getKeybinding();
  applyTexts();
  window.arcadeerFadeInDialog(dialog);
}

// WASMや他モジュールから呼べるようグローバルへ公開する
if (typeof window !== "undefined") {
  window.arcadeerShowSettings = showSettings;
}
